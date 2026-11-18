import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ok } from '../src/shared/kernel/index.js';
import { NodeCryptoPrimitives } from '../src/modules/crypto/index.js';
import { packClientSecret } from '../src/modules/federation/domain/client-secret.js';
import type { OidcAmbientContext } from '../src/modules/federation/application/ports/oidc-ambient.js';
import { createPgOidcAdapter } from '../src/modules/federation/infrastructure/oidc/pg-oidc-adapter.js';
import { PgOidcOrgResolver } from '../src/modules/federation/infrastructure/oidc/oidc-org-resolver.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Adaptador de `oidc-provider` sobre PostgreSQL con el rol de la aplicación (`iam_app`, sin BYPASSRLS):
 * ¿el almacenamiento aísla por organización, guarda hashes, recorta el vencimiento a la sesión de Compass y
 * rechaza escribir credenciales que sobrevivirían a la sesión o a la concesión?
 */

const CLIENT_SECRET = 'secreto-de-prueba';

let db: TestDatabase;
let ambientContext: OidcAmbientContext | null = null;
let Adapter: ReturnType<typeof createPgOidcAdapter>;
const primitives = new NodeCryptoPrimitives();
const requestContext = new AsyncLocalRequestContext();

interface Fixture {
  readonly organization: string;
  readonly user: string;
  readonly session: string;
  readonly clientId: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  Adapter = createPgOidcAdapter({
    scope: new PgTenantScope(requestContext, uow),
    transactions: uow,
    resolver: new PgOidcOrgResolver(db.appPool),
    ambient: { current: () => ambientContext },
    primitives,
    // El cifrado real ya está probado en el módulo de criptografía: aquí solo importa el flujo.
    cipher: { decrypt: () => Promise.resolve(ok(new TextEncoder().encode(CLIENT_SECRET))) },
    ids: new UuidV7Generator(),
    clock: { now: () => new Date() },
  });
});

afterAll(async () => {
  await db.close();
});

const randomHash = (): Buffer =>
  Buffer.from(
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    'hex',
  );

async function seedFixture(slug: string, sessionTtl = '1 hour'): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const user = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const userId = user.rows[0]?.id;
  if (userId === undefined) throw new Error('user seed failed');
  const session = await db.admin.query<{ id: string }>(
    `insert into sessions (organization_id, user_id, token_hash, expires_at)
     values ($1, $2, $3, now() + $4::interval) returning id`,
    [organization, userId, randomHash(), sessionTtl],
  );
  const sessionId = session.rows[0]?.id;
  if (sessionId === undefined) throw new Error('session seed failed');
  const clientId = `cmp_${crypto.randomUUID().replaceAll('-', '')}`;
  const packed = packClientSecret({
    dekVersion: 1,
    nonce: new Uint8Array(12),
    ciphertext: new Uint8Array(32),
  });
  await db.admin.query(
    `insert into oidc_clients (organization_id, client_id, name, secret_ciphertext, redirect_uris,
                               allow_refresh_tokens, refresh_justification, max_rank, created_by)
     values ($1, $2, 'Grafana', $3, array['https://grafana.example.test/cb'], true,
             'Sesiones largas de monitoreo', 2, $4)`,
    [organization, clientId, Buffer.from(packed), userId],
  );
  return { organization, user: userId, session: sessionId, clientId };
}

const asBrowser = (fixture: Fixture): void => {
  ambientContext = {
    organizationId: fixture.organization,
    compassSessionId: fixture.session,
    userId: fixture.user,
  };
};
const asClient = (): void => {
  ambientContext = null;
};

async function createGrant(fixture: Fixture, grantId: string): Promise<void> {
  asBrowser(fixture);
  await new Adapter('Grant').upsert(
    grantId,
    { jti: grantId, accountId: fixture.user, clientId: fixture.clientId },
    3600,
  );
}

describe('PgOidcAdapter', () => {
  it('guarda tokens con hash, sin jti, y los lee desde el cliente sin sesión de Compass', async () => {
    const fixture = await seedFixture('oidc-roundtrip');
    const grantId = `grant-${crypto.randomUUID()}`;
    await createGrant(fixture, grantId);

    asClient();
    const tokenId = `at-${crypto.randomUUID()}`;
    await new Adapter('AccessToken').upsert(
      tokenId,
      { jti: tokenId, grantId, clientId: fixture.clientId, accountId: fixture.user },
      300,
    );

    const found = await new Adapter('AccessToken').find(tokenId);
    expect(found).toMatchObject({ jti: tokenId, grantId, clientId: fixture.clientId });

    const stored = await db.admin.query<{ payload: Record<string, unknown>; key_hash: Buffer }>(
      `select payload, key_hash from oidc_payloads where model = 'AccessToken' and organization_id = $1`,
      [fixture.organization],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.payload).not.toHaveProperty('jti');
    expect(stored.rows[0]?.key_hash.toString('hex')).not.toContain(
      Buffer.from(tokenId).toString('hex'),
    );
    const row = await db.admin.query<{ user_id: string; compass_session_id: string }>(
      `select user_id, compass_session_id from oidc_payloads where model = 'AccessToken' and organization_id = $1`,
      [fixture.organization],
    );
    expect(row.rows[0]).toEqual({ user_id: fixture.user, compass_session_id: fixture.session });
  });

  it('recorta el vencimiento al de la sesión de Compass', async () => {
    const fixture = await seedFixture('oidc-clip', '10 minutes');
    const grantId = `grant-${crypto.randomUUID()}`;
    await createGrant(fixture, grantId);
    asClient();
    const tokenId = `rt-${crypto.randomUUID()}`;
    await new Adapter('RefreshToken').upsert(
      tokenId,
      { jti: tokenId, grantId, clientId: fixture.clientId },
      30 * 24 * 3600,
    );

    const result = await db.admin.query<{ clipped: boolean }>(
      `select abs(extract(epoch from (p.expires_at - s.expires_at))) < 0.001 as clipped
         from oidc_payloads p join sessions s on s.id = p.compass_session_id
        where p.model = 'RefreshToken' and p.organization_id = $1`,
      [fixture.organization],
    );
    expect(result.rows[0]?.clipped).toBe(true);
  });

  it('no escribe un token de una concesión revocada ni de una sesión muerta', async () => {
    const fixture = await seedFixture('oidc-dead');
    const grantId = `grant-${crypto.randomUUID()}`;
    await createGrant(fixture, grantId);
    asClient();
    await new Adapter('Grant').revokeByGrantId(grantId);

    await expect(
      new Adapter('AccessToken').upsert(
        `at-${crypto.randomUUID()}`,
        { grantId, clientId: fixture.clientId },
        300,
      ),
    ).rejects.toThrow('Grant was revoked');

    const second = await seedFixture('oidc-dead-session');
    await createGrant(second, `grant-${crypto.randomUUID()}`);
    await db.admin.query(`update sessions set revoked_at = now() where id = $1`, [second.session]);
    asBrowser(second);
    await expect(
      new Adapter('Session').upsert(
        `sess-${crypto.randomUUID()}`,
        { accountId: second.user, uid: crypto.randomUUID() },
        3600,
      ),
    ).rejects.toThrow('no longer alive');
  });

  it('aísla organizaciones: otra sesión de Compass no lee ni destruye tokens ajenos', async () => {
    const a = await seedFixture('oidc-iso-a');
    const b = await seedFixture('oidc-iso-b');
    const grantId = `grant-${crypto.randomUUID()}`;
    await createGrant(a, grantId);
    asClient();
    const tokenId = `at-${crypto.randomUUID()}`;
    await new Adapter('AccessToken').upsert(tokenId, { grantId, clientId: a.clientId }, 300);

    asBrowser(b);
    expect(await new Adapter('AccessToken').find(tokenId)).toBeUndefined();
    await new Adapter('AccessToken').destroy(tokenId);
    asClient();
    expect(await new Adapter('AccessToken').find(tokenId)).toBeDefined();

    // Un cliente de A con una sesión de B se rechaza al escribir.
    asBrowser(b);
    await expect(
      new Adapter('Grant').upsert(`grant-${crypto.randomUUID()}`, { clientId: a.clientId }, 300),
    ).rejects.toThrow('does not belong');
  });

  it('consume, destruye y revoca por concesión', async () => {
    const fixture = await seedFixture('oidc-lifecycle');
    const grantId = `grant-${crypto.randomUUID()}`;
    await createGrant(fixture, grantId);
    asClient();
    const code = `code-${crypto.randomUUID()}`;
    const other = `at-${crypto.randomUUID()}`;
    await new Adapter('AuthorizationCode').upsert(
      code,
      { grantId, clientId: fixture.clientId },
      60,
    );
    await new Adapter('AccessToken').upsert(other, { grantId, clientId: fixture.clientId }, 300);

    await new Adapter('AuthorizationCode').consume(code);
    const consumed = await new Adapter('AuthorizationCode').find(code);
    expect(typeof consumed?.['consumed']).toBe('number');

    await new Adapter('AuthorizationCode').revokeByGrantId(grantId);
    expect(await new Adapter('AuthorizationCode').find(code)).toBeUndefined();
    expect(await new Adapter('AccessToken').find(other)).toBeUndefined();
    expect(await new Adapter('Grant').find(grantId)).toBeUndefined();
  });

  it('busca la sesión y la interacción por uid conservando su jti', async () => {
    const fixture = await seedFixture('oidc-uid');
    asBrowser(fixture);
    const uid = crypto.randomUUID();
    const jti = `sess-${crypto.randomUUID()}`;
    await new Adapter('Session').upsert(jti, { jti, uid, accountId: fixture.user }, 3600);

    const found = await new Adapter('Session').findByUid(uid);
    expect(found).toMatchObject({ jti, uid });
    // La interacción sí se encuentra sin la cookie de Compass; la sesión del proveedor no (ver abajo).
    const interactionId = `int-${crypto.randomUUID()}`;
    const interactionUid = crypto.randomUUID();
    await new Adapter('Interaction').upsert(
      interactionId,
      { jti: interactionId, uid: interactionUid, params: { client_id: fixture.clientId } },
      600,
    );
    asClient();
    expect(await new Adapter('Interaction').findByUid(interactionUid)).toMatchObject({
      jti: interactionId,
    });
  });

  it('no sirve la sesión del proveedor sin la sesión de Compass a la que está ligada (L8)', async () => {
    const fixture = await seedFixture('oidc-session-link');
    asBrowser(fixture);
    const uid = crypto.randomUUID();
    const jti = `sess-${crypto.randomUUID()}`;
    await new Adapter('Session').upsert(jti, { jti, uid, accountId: fixture.user }, 3600);

    // Sin cookie de Compass (por ejemplo, una llamada de cliente o la cookie del proveedor sola) la sesión del
    // proveedor no sirve para autenticar a nadie...
    asClient();
    expect(await new Adapter('Session').find(jti)).toBeUndefined();
    // ...pero el vínculo de un token (punto de token) se comprueba por uid mientras viva la sesión de Compass.
    expect(await new Adapter('Session').findByUid(uid)).toMatchObject({ jti, uid });
    await db.admin.query(`update sessions set revoked_at = now() where id = $1`, [fixture.session]);
    expect(await new Adapter('Session').findByUid(uid)).toBeUndefined();

    // Con la cookie de otra sesión de Compass de la misma organización.
    ambientContext = {
      organizationId: fixture.organization,
      compassSessionId: crypto.randomUUID(),
      userId: fixture.user,
    };
    expect(await new Adapter('Session').findByUid(uid)).toBeUndefined();
    expect(await new Adapter('Session').find(jti)).toBeUndefined();

    asBrowser(fixture);
    expect(await new Adapter('Session').find(jti)).toMatchObject({ jti, uid });
  });

  it('sirve el cliente activo con su secreto y no sirve uno deshabilitado', async () => {
    const fixture = await seedFixture('oidc-client');
    asClient();

    const metadata = await new Adapter('Client').find(fixture.clientId);
    expect(metadata).toMatchObject({
      client_id: fixture.clientId,
      client_secret: CLIENT_SECRET,
      grant_types: ['authorization_code', 'refresh_token'],
      compass_max_rank: 2,
      compass_is_external: false,
    });

    await db.admin.query(
      `update oidc_clients set status = 'disabled', disabled_at = now() where client_id = $1`,
      [fixture.clientId],
    );
    expect(await new Adapter('Client').find(fixture.clientId)).toBeUndefined();
    expect(await new Adapter('Client').find('cmp_inexistente')).toBeUndefined();
  });

  it('falla fuerte con un modelo no habilitado', () => {
    expect(() => new Adapter('DeviceCode')).toThrow('Unsupported');
  });
});
