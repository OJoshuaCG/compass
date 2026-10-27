import { randomUUID } from 'node:crypto';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSync } from 'otplib';
import { Pool } from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { buildContainer } from '../../src/app/container.js';
import type { Container } from '../../src/app/container.js';
import { createApp } from '../../src/app/create-app.js';
import { LocalKeyManagement } from '../../src/modules/crypto/index.js';
import { ManualClock } from '../../src/modules/crypto/testing/manual-clock.js';
import { OWASP_ARGON2_PARAMS } from '../../src/modules/identity/index.js';
import { NodeCryptoPrimitives } from '../../src/modules/crypto/index.js';
import { InMemoryMailer } from '../../src/modules/notification/index.js';
import {
  BootstrapOrganization,
  PgOrganizationSeeder,
} from '../../src/modules/provisioning/index.js';
import { createLogger } from '../../src/shared/infrastructure/logger.js';
import { createTestDatabase } from './database.js';
import type { TestDatabase } from './database.js';

export const APP_ORIGIN = 'http://app.test';
export const STRONG_PASSWORD = 'Correct-Horse-Battery-Staple-9';

export interface E2eEnvironment {
  readonly db: TestDatabase;
  readonly app: NestFastifyApplication;
  readonly container: Container;
  readonly clock: ManualClock;
  readonly mailer: InMemoryMailer;
  readonly adminPool: Pool;
  bootstrapOrganization(input: {
    slug: string;
    rootEmail: string;
    rootName: string;
    /** Deja la contraseña inicial de la Raíz como de un solo uso (por defecto ya está cambiada). */
    keepInitialPassword?: boolean;
  }): Promise<{ organizationId: string; rootUserId: string; emergencyCodes: readonly string[] }>;
  close(): Promise<void>;
}

/** Levanta la API completa (Nest + Fastify) contra un PostgreSQL real, con reloj y correo controlables. */
export async function startEnvironment(clusterAdminUrl: string): Promise<E2eEnvironment> {
  const db = await createTestDatabase(clusterAdminUrl);
  const kekDir = mkdtempSync(join(tmpdir(), 'iam-e2e-kek-'));
  const clock = new ManualClock(new Date());
  const mailer = new InMemoryMailer();
  const logger = createLogger({ level: process.env['E2E_LOG'] ?? 'silent' });
  const container = buildContainer({
    pool: db.appPool,
    independentPool: db.independentPool,
    mailer,
    kms: new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' }),
    logger,
    clock,
    // Costo mínimo de Argon2: las pruebas hacen decenas de inicios de sesión.
    argon2: { ...OWASP_ARGON2_PARAMS, memoryCost: 1024, timeCost: 1 },
  });
  const app = await createApp({ logger, container, appOrigin: APP_ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const adminPool = new Pool({ connectionString: db.adminUrl, max: 2 });

  const bootstrap = new BootstrapOrganization({
    seeder: new PgOrganizationSeeder(adminPool),
    hasher: container.hasher,
    strength: container.strength,
    ids: container.ids,
    randomBytes: (length) => new NodeCryptoPrimitives().randomBytes(length),
    sha256: (data) => new NodeCryptoPrimitives().sha256(data),
  });

  return {
    db,
    app,
    container,
    clock,
    mailer,
    adminPool,
    async bootstrapOrganization(input) {
      const result = await bootstrap.execute({
        name: `Org ${input.slug}`,
        slug: input.slug,
        rootEmail: input.rootEmail,
        rootDisplayName: input.rootName,
        rootPassword: STRONG_PASSWORD,
      });
      if (input.keepInitialPassword !== true) {
        // La mayoría de las pruebas parten de una Raíz que ya cambió su contraseña inicial.
        await adminPool.query('update user_passwords set must_change = false where user_id = $1', [
          result.rootUserId,
        ]);
      }
      return {
        organizationId: result.organizationId,
        rootUserId: result.rootUserId,
        emergencyCodes: result.emergencyCodes,
      };
    },
    async close() {
      await app.close();
      await adminPool.end();
      // `app.close()` no cierra los pools del contenedor: los cierra `db.close()`.
      await db.close();
      rmSync(kekDir, { recursive: true, force: true });
    },
  };
}

export interface ApiResponse<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Record<string, string | string[] | number | undefined>;
}

/** Cliente HTTP de pruebas con su propio "navegador" (cookie jar) y las cabeceras que exige el CSRF. */
export class TestClient {
  cookie: string | null = null;

  constructor(
    private readonly env: E2eEnvironment,
    private readonly ip = '203.0.113.10',
  ) {}

  async request<T = unknown>(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const response = await this.env.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(payload === undefined ? {} : { payload: payload as object }),
      remoteAddress: this.ip,
      headers: {
        // Como el cliente real: cada POST lleva una clave de idempotencia nueva salvo que se indique.
        ...(method === 'POST'
          ? { 'x-requested-with': 'test', origin: APP_ORIGIN, 'idempotency-key': randomUUID() }
          : {}),
        ...(this.cookie === null ? {} : { cookie: `__Host-session=${this.cookie}` }),
        ...headers,
      },
    });
    for (const set of response.cookies) {
      if (set.name === '__Host-session') this.cookie = set.value === '' ? null : set.value;
    }
    const text = response.body;
    return {
      status: response.statusCode,
      body: (text === '' ? undefined : JSON.parse(text)) as T,
      headers: response.headers,
    };
  }

  get = <T = unknown>(url: string) => this.request<T>('GET', url);
  post = <T = unknown>(url: string, payload?: unknown, headers?: Record<string, string>) =>
    this.request<T>('POST', url, payload ?? {}, headers);
}

export interface EnrolledSession {
  readonly client: TestClient;
  readonly secret: string;
  readonly recoveryCodes: string[];
}

/** Código TOTP válido para el instante actual del reloj de pruebas. */
export const totpNow = (secret: string, clock: ManualClock): string =>
  generateSync({ secret, strategy: 'totp', epoch: Math.floor(clock.now().getTime() / 1000) });

/**
 * Un código nuevo: el reloj avanza un paso (30 s) para que el paso de tiempo sea mayor al último
 * aceptado (protección contra reutilización) y el código siga dentro de la tolerancia.
 */
export const freshTotp = (secret: string, clock: ManualClock): string => {
  clock.advance(30_000);
  return totpNow(secret, clock);
};

/** Contraseña + registro del segundo factor: deja la sesión completa y devuelve secreto y códigos. */
export async function enroll(env: E2eEnvironment, client: TestClient): Promise<EnrolledSession> {
  const begin = await client.post<{ secret: string }>('/auth/mfa/totp/enroll');
  if (begin.status !== 200) throw new Error(`enroll failed: ${String(begin.status)}`);
  const secret = begin.body.secret;
  const confirm = await client.post<{ recoveryCodes: string[] }>('/auth/mfa/totp/confirm', {
    code: totpNow(secret, env.clock),
  });
  if (confirm.status !== 200) throw new Error(`confirm failed: ${String(confirm.status)}`);
  return { client, secret, recoveryCodes: confirm.body.recoveryCodes };
}

/** Inicio de sesión completo de un usuario que ya tiene su segundo factor registrado. */
export async function signIn(
  env: E2eEnvironment,
  email: string,
  secret: string,
  password = STRONG_PASSWORD,
  ip?: string,
): Promise<TestClient> {
  const client = new TestClient(env, ip);
  const login = await client.post('/auth/login', { email, password });
  if (login.status !== 200) throw new Error(`login failed: ${String(login.status)}`);
  const verify = await client.post('/auth/mfa/verify', { code: freshTotp(secret, env.clock) });
  if (verify.status !== 204) throw new Error(`mfa failed: ${String(verify.status)}`);
  return client;
}

/** La Raíz invita; el invitado abre el enlace del correo, define su contraseña y registra el 2FA. */
export async function inviteAndOnboard(
  env: E2eEnvironment,
  inviter: TestClient,
  input: { email: string; rank: 1 | 2 | 3; roleIds?: string[]; name?: string },
): Promise<EnrolledSession> {
  const created = await inviter.post('/invitations', {
    email: input.email,
    rank: input.rank,
    roleIds: input.roleIds ?? [],
  });
  if (created.status !== 201) throw new Error(`invite failed: ${String(created.status)}`);
  const token = env.mailer.last?.token ?? '';
  const guest = new TestClient(env, '198.51.100.20');
  const accepted = await guest.post('/invitations/accept', {
    token,
    displayName: input.name ?? 'Invited Person',
    password: STRONG_PASSWORD,
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${String(accepted.status)}`);
  return enroll(env, guest);
}
