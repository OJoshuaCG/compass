import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant } from './helpers.js';

// Seguimiento de G6 / ADR 0023: misma medición que `audit-latency.test.ts`, pero con una MEZCLA de
// escritores. Una parte simula una transacción larga tipo `DeactivateUser` (lecturas y bloqueos de
// filas ANTES de auditar, con la fila de auditoría como último paso, como se verificó en G6) y el
// resto escribe auditoría corta. El bloqueo de la cadena de hash se toma al insertar el evento, así
// que los escritores largos lo retienen solo desde que auditan hasta el commit; el trabajo previo
// no bloquea a nadie. Sirve para detectar contención, no para dimensionar capacidad.

/** Mismo valor que usa la API para las transacciones que auditan (ADR 0023, decisión 2). */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * CIFRAS DE APROBACIÓN: propuesta pendiente de confirmar por el equipo (como las demás cifras de I1).
 * Son deliberadamente holgadas: la medición con 50 escritores cortos dio p95 386 ms y máximo 488 ms,
 * así que 1 s de p95 deja margen para la mezcla sin volver la prueba intermitente en equipos lentos.
 */
const MAX_P95_AUDIT_WRITE_MS = 1_000;
/** Margen bajo el `lock_timeout`: un máximo que roza los 5 s ya es contención, aunque no falle. */
const LOCK_TIMEOUT_SAFETY_MARGIN_MS = 1_000;
const MAX_AUDIT_WRITE_MS = LOCK_TIMEOUT_MS - LOCK_TIMEOUT_SAFETY_MARGIN_MS;

const SHORT_WRITERS = 40;
const LONG_WRITERS = 10;
const SHORT_TRANSACTIONS_PER_WRITER = 20;
const LONG_TRANSACTIONS_PER_WRITER = 10;
/** Lecturas previas a la auditoría por transacción larga (jerarquía, sesiones, credenciales...). */
const LONG_PRE_AUDIT_READS = 8;
const MEASUREMENT_TEST_TIMEOUT_MS = 120_000;
const LATENCY_REPORT_PATH = join(tmpdir(), 'compass-audit-latency-mixed.json');

type WriterKind = 'short' | 'long';

interface LatencySummary {
  readonly kind: WriterKind;
  readonly writers: number;
  readonly transactions: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

let appUrl = '';
let adminUrl = '';

/** Percentil por rango más cercano sobre una muestra ya ordenada de menor a mayor. */
function percentile(sortedSamples: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sortedSamples.length);
  const index = Math.min(sortedSamples.length - 1, Math.max(0, rank - 1));
  return sortedSamples[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarize(kind: WriterKind, writers: number, samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    kind,
    writers,
    transactions: sorted.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

/**
 * Una transacción con el molde de la API. Si es larga, primero lee y bloquea filas (sin tocar la
 * cadena de auditoría). Devuelve solo lo que tarda el insert del evento, que es donde se espera el
 * bloqueo de la cadena; un `lock_timeout` vencido rechaza la promesa y hace fallar la prueba.
 */
async function auditedTransaction(
  client: Client,
  kind: WriterKind,
  orgId: string,
  actorId: string,
  sequence: number,
): Promise<number> {
  let auditWriteMs = 0;
  await inOrg(client, orgId, async () => {
    await client.query(`set local lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`);
    if (kind === 'long') {
      // Bloqueo de la fila del actor (como el de jerarquía de DeactivateUser) y lecturas. Es
      // `no key update` para no chocar con el `key share` que la clave foránea del evento toma.
      await client.query('select id from users where id = $1 for no key update', [actorId]);
      for (let read = 0; read < LONG_PRE_AUDIT_READS; read += 1) {
        await client.query('select count(*) from users where organization_id = $1', [orgId]);
      }
    }
    const startedAt = performance.now();
    await client.query(
      "insert into audit_events (organization_id, actor_id, action, outcome, metadata) values ($1, $2, 'credential.revealed', 'success', $3)",
      [orgId, actorId, JSON.stringify({ kind, n: sequence })],
    );
    auditWriteMs = performance.now() - startedAt;
  });
  return auditWriteMs;
}

async function runWriters(
  clients: readonly Client[],
  kind: WriterKind,
  transactionsPerWriter: number,
  orgId: string,
  actorIdFor: (writerIndex: number) => string,
  sequenceOffset: number,
): Promise<number[]> {
  const samplesPerWriter = await Promise.all(
    clients.map(async (client, writerIndex) => {
      const samples: number[] = [];
      for (let iteration = 0; iteration < transactionsPerWriter; iteration += 1) {
        const sequence = sequenceOffset + writerIndex * transactionsPerWriter + iteration;
        samples.push(
          await auditedTransaction(client, kind, orgId, actorIdFor(writerIndex), sequence),
        );
      }
      return samples;
    }),
  );
  return samplesPerWriter.flat();
}

describe('audit latency with a mix of short and long (DeactivateUser-like) writers', () => {
  beforeAll(async () => {
    const db = await createMigratedDatabase(inject('adminUrl'));
    appUrl = db.appUrl;
    adminUrl = db.adminUrl;
  });

  const summaries: LatencySummary[] = [];

  afterAll(async () => {
    // Igual que la prueba base: el reporter oculta la consola de lo que pasa, así que las cifras se
    // dejan en un archivo temporal fuera del repositorio para copiarlas al ADR 0023 y al TODO.
    await writeFile(LATENCY_REPORT_PATH, JSON.stringify(summaries, null, 2), 'utf8');
  });

  it(
    'keeps both short and long writers below lock_timeout and the chain intact',
    async () => {
      const tenant = await seedTenant(appUrl, adminUrl, 'latencymixed');
      const shortClients = await Promise.all(
        Array.from({ length: SHORT_WRITERS }, () => connect(appUrl)),
      );
      const longClients = await Promise.all(
        Array.from({ length: LONG_WRITERS }, () => connect(appUrl)),
      );
      const verifier = await connect(appUrl);
      try {
        // Ambos grupos arrancan a la vez: la mezcla compite por el mismo bloqueo de la cadena.
        const [shortSamples, longSamples] = await Promise.all([
          runWriters(
            shortClients,
            'short',
            SHORT_TRANSACTIONS_PER_WRITER,
            tenant.orgId,
            () => tenant.rootId,
            0,
          ),
          runWriters(
            longClients,
            'long',
            LONG_TRANSACTIONS_PER_WRITER,
            tenant.orgId,
            () => tenant.rootId,
            SHORT_WRITERS * SHORT_TRANSACTIONS_PER_WRITER,
          ),
        ]);

        const shortSummary = summarize('short', SHORT_WRITERS, shortSamples);
        const longSummary = summarize('long', LONG_WRITERS, longSamples);
        summaries.push(shortSummary, longSummary);

        // Falla cerrada: un lock_timeout vencido rechaza la promesa, así que llegar aquí ya implica
        // cero fallos; el conteo confirma que ninguna transacción se perdió.
        expect(shortSummary.transactions).toBe(SHORT_WRITERS * SHORT_TRANSACTIONS_PER_WRITER);
        expect(longSummary.transactions).toBe(LONG_WRITERS * LONG_TRANSACTIONS_PER_WRITER);

        for (const summary of [shortSummary, longSummary]) {
          expect(summary.p95Ms).toBeLessThan(MAX_P95_AUDIT_WRITE_MS);
          expect(summary.maxMs).toBeLessThan(MAX_AUDIT_WRITE_MS);
        }

        const verdict = await inOrg(verifier, tenant.orgId, () =>
          verifier.query<{ broken: string | null; total: string }>(
            'select audit_verify_chain()::text as broken, (select count(*) from audit_events)::text as total',
          ),
        );
        expect(verdict.rows[0]?.broken).toBeNull();
        expect(Number(verdict.rows[0]?.total)).toBeGreaterThanOrEqual(
          shortSummary.transactions + longSummary.transactions,
        );
      } finally {
        await Promise.all(
          [...shortClients, ...longClients, verifier].map((client) => client.end()),
        );
      }
    },
    MEASUREMENT_TEST_TIMEOUT_MS,
  );
});
