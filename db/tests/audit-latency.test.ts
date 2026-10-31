import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant } from './helpers.js';

// Medición pendiente del ADR 0023: latencia de las transacciones que auditan cuando varios
// escritores compiten por el bloqueo de la cadena de una misma organización. Sirve para detectar
// contención, no para dimensionar capacidad: corre en un contenedor local, no en el servidor
// dedicado de producción.

/** Mismo valor que usa la API para las transacciones que auditan (ADR 0023, decisión 2). */
const LOCK_TIMEOUT_MS = 5_000;
const TRANSACTIONS_PER_WRITER = 20;
const CONCURRENCY_LEVELS = [5, 20, 50] as const;
const MEASUREMENT_TEST_TIMEOUT_MS = 120_000;
const LATENCY_REPORT_PATH = join(tmpdir(), 'compass-audit-latency.json');

let appUrl = '';
let adminUrl = '';

interface LatencySummary {
  readonly writers: number;
  readonly transactions: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/** Percentil por rango más cercano sobre una muestra ya ordenada de menor a mayor. */
function percentile(sortedSamples: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sortedSamples.length);
  const index = Math.min(sortedSamples.length - 1, Math.max(0, rank - 1));
  return sortedSamples[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarize(writers: number, samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    writers,
    transactions: sorted.length,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

/** Una escritura auditada con el mismo molde que la API: transacción propia, org fijada y lock_timeout. */
async function auditedWrite(
  client: Client,
  orgId: string,
  actorId: string,
  sequence: number,
): Promise<number> {
  const startedAt = performance.now();
  await inOrg(client, orgId, async () => {
    await client.query(`set local lock_timeout = '${String(LOCK_TIMEOUT_MS)}ms'`);
    await client.query(
      "insert into audit_events (organization_id, actor_id, action, outcome, metadata) values ($1, $2, 'credential.revealed', 'success', $3)",
      [orgId, actorId, JSON.stringify({ n: sequence })],
    );
  });
  return performance.now() - startedAt;
}

describe('audit latency under concurrent writers', () => {
  beforeAll(async () => {
    const db = await createMigratedDatabase(inject('adminUrl'));
    appUrl = db.appUrl;
    adminUrl = db.adminUrl;
  });

  const summaries: LatencySummary[] = [];

  afterAll(async () => {
    // El reporter de vitest oculta la consola de las pruebas que pasan, así que la tabla se deja en
    // un archivo temporal para copiarla al ADR 0023 y al TODO. No se escribe dentro del repositorio.
    await writeFile(LATENCY_REPORT_PATH, JSON.stringify(summaries, null, 2), 'utf8');
  });

  for (const writers of CONCURRENCY_LEVELS) {
    it(
      `keeps the chain intact and far below lock_timeout with ${String(writers)} concurrent writers`,
      async () => {
        const tenant = await seedTenant(appUrl, adminUrl, `latency${String(writers)}`);
        const clients = await Promise.all(Array.from({ length: writers }, () => connect(appUrl)));
        const verifier = await connect(appUrl);
        try {
          const samplesPerWriter = await Promise.all(
            clients.map(async (client, writerIndex) => {
              const samples: number[] = [];
              for (let iteration = 0; iteration < TRANSACTIONS_PER_WRITER; iteration += 1) {
                const sequence = writerIndex * TRANSACTIONS_PER_WRITER + iteration;
                samples.push(await auditedWrite(client, tenant.orgId, tenant.rootId, sequence));
              }
              return samples;
            }),
          );
          const summary = summarize(writers, samplesPerWriter.flat());
          summaries.push(summary);

          // Sin ninguna transacción fallida (un lock_timeout vencido habría rechazado la promesa) y
          // sin acercarse al tope: si el p99 roza los 5 s se abre el plan B del ADR 0023.
          expect(summary.transactions).toBe(writers * TRANSACTIONS_PER_WRITER);
          expect(summary.p99Ms).toBeLessThan(LOCK_TIMEOUT_MS / 2);

          const verdict = await inOrg(verifier, tenant.orgId, () =>
            verifier.query<{ broken: string | null; total: string }>(
              'select audit_verify_chain()::text as broken, (select count(*) from audit_events)::text as total',
            ),
          );
          expect(verdict.rows[0]?.broken).toBeNull();
          expect(Number(verdict.rows[0]?.total)).toBeGreaterThanOrEqual(
            writers * TRANSACTIONS_PER_WRITER,
          );
        } finally {
          await Promise.all([...clients, verifier].map((client) => client.end()));
        }
      },
      MEASUREMENT_TEST_TIMEOUT_MS,
    );
  }
});
