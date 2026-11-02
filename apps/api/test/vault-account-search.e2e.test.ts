import type { AccountListItem, ProblemDetails, Role } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B6: búsqueda de texto, filtros rápidos y semáforo de antigüedad de la contraseña.
// Regla de seguridad: todo se resuelve en SQL sobre el acceso efectivo; una persona sin acceso a una
// cuenta no la obtiene por ninguna vía de búsqueda.
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let admin: EnrolledSession;
let operator: EnrolledSession;
let outsider: EnrolledSession;
let totpPlatformId: string;
let plainPlatformId: string;
let totpPlatformName: string;

interface Page {
  data: AccountListItem[];
  page: { nextCursor: string | null; limit: number };
}

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const daysAgo = (days: number): Date =>
  new Date(env.clock.now().getTime() - days * MILLISECONDS_PER_DAY);

const createAccount = async (
  session: EnrolledSession,
  displayName: string,
  extra: Record<string, unknown> = {},
): Promise<AccountListItem> => {
  const response = await session.client.post<AccountListItem>('/accounts', {
    platformId: plainPlatformId,
    displayName,
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body;
};

/** Credencial insertada directo en la base: fija las fechas de cambio sin esperar días reales. */
const addCredential = async (
  accountId: string,
  options: { rotatedDaysAgo?: number; createdDaysAgo?: number; archived?: boolean } = {},
): Promise<string> => {
  const creator = await userId('operator@search.test');
  const createdAt = daysAgo(options.createdDaysAgo ?? 0);
  const rotatedAt = options.rotatedDaysAgo === undefined ? null : daysAgo(options.rotatedDaysAgo);
  const inserted = await env.db.admin.query<{ id: string }>(
    `insert into credentials (organization_id, account_id, label, kind, last_rotated_at, created_by,
                              created_at, archived_at)
     values ($1, $2, 'main', 'password', $3, $4, $5, $6)
     returning id`,
    [
      orgId,
      accountId,
      rotatedAt,
      creator,
      createdAt,
      options.archived === true ? new Date() : null,
    ],
  );
  return inserted.rows[0]?.id ?? '';
};

const verifyTotp = async (credentialId: string): Promise<void> => {
  const registrar = await userId('operator@search.test');
  await env.db.admin.query(
    `insert into credential_totp (organization_id, credential_id, secret_version, status, algorithm,
                                  digits, period_seconds, registered_by, verified_at)
     values ($1, $2, 1, 'verified', 'SHA1', 6, 30, $3, now())`,
    [orgId, credentialId, registrar],
  );
};

const search = async (
  session: EnrolledSession,
  query: Record<string, string>,
  path = '/accounts',
): Promise<AccountListItem[]> => {
  const response = await session.client.get<Page>(
    `${path}?${new URLSearchParams(query).toString()}`,
  );
  expect(response.status).toBe(200);
  return response.body.data;
};

const names = (items: readonly AccountListItem[]): string[] =>
  items.map((item) => item.displayName);

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'search',
    rootEmail: 'root@search.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.80');
  await rootClient.post('/auth/login', { email: 'root@search.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';
  admin = await inviteAndOnboard(env, root.client, {
    email: 'admin@search.test',
    rank: 1,
    roleIds: [roleId('Administrator')],
  });
  operator = await inviteAndOnboard(env, root.client, {
    email: 'operator@search.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });
  outsider = await inviteAndOnboard(env, root.client, {
    email: 'outsider@search.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });

  const platforms = await operator.client.get<{
    data: { id: string; name: string; supportsTotp: boolean }[];
  }>('/platforms');
  const withTotp = platforms.body.data.find((platform) => platform.supportsTotp);
  const withoutTotp = platforms.body.data.find((platform) => !platform.supportsTotp);
  totpPlatformId = withTotp?.id ?? '';
  totpPlatformName = withTotp?.name ?? '';
  // Si el catálogo no trae una plataforma sin segundo factor, se reutiliza la primera: solo cambia el filtro «sin 2FA».
  plainPlatformId = withoutTotp?.id ?? totpPlatformId;
});

afterAll(async () => {
  await env.close();
});

describe('text search', () => {
  it('matches display name, handle, platform, tag and group, ignoring case', async () => {
    const groupId = (
      await env.db.admin.query<{ id: string }>(
        'insert into groups (organization_id, name, created_by) values ($1, $2, $3) returning id',
        [orgId, 'Marketing Squad', await userId('root@search.test')],
      )
    ).rows[0]?.id;
    await createAccount(operator, 'Zebra Brand', {
      handle: '@zebra_handle',
      tags: ['campaign-x'],
      ...(groupId === undefined ? {} : { ownerGroupId: groupId }),
    });

    expect(names(await search(operator, { q: 'zebra b' }))).toEqual(['Zebra Brand']);
    expect(names(await search(operator, { q: 'ZEBRA_HANDLE' }))).toEqual(['Zebra Brand']);
    expect(names(await search(operator, { q: 'campaign' }))).toEqual(['Zebra Brand']);
    expect(names(await search(operator, { q: 'marketing' }))).toEqual(['Zebra Brand']);
  });

  it('matches the platform name of the account', async () => {
    await createAccount(operator, 'Platform Probe', { platformId: totpPlatformId });

    expect(names(await search(operator, { q: totpPlatformName }))).toContain('Platform Probe');
    expect(names(await search(outsider, { q: totpPlatformName }))).toEqual([]);
  });

  it('treats % and _ literally instead of as wildcards', async () => {
    await createAccount(operator, '100%_Sure');
    await createAccount(operator, 'Plain Account');

    expect(names(await search(operator, { q: '%' }))).toEqual(['100%_Sure']);
    // 'Zebra Brand' tiene el handle «@zebra_handle»: el guion bajo literal también lo encuentra.
    expect(names(await search(operator, { q: '_' }))).toEqual(['100%_Sure', 'Zebra Brand']);
    // Un comodín sin escapar ('Z_bra') encontraría «Zebra»; literal, no encuentra nada.
    expect(names(await search(operator, { q: 'Z_bra' }))).toEqual([]);
    expect(names(await search(operator, { q: '\\' }))).toEqual([]);
  });

  it('never returns an account the person has no access to, by any search path', async () => {
    const hidden = await createAccount(operator, 'Hidden Vault Entry', {
      handle: '@hidden_user',
      tags: ['secret-tag'],
    });

    for (const term of ['Hidden Vault', 'hidden_user', 'secret-tag']) {
      expect(names(await search(outsider, { q: term }))).toEqual([]);
    }
    expect((await search(outsider, {})).map((item) => item.id)).not.toContain(hidden.id);
    expect(names(await search(operator, { q: 'secret-tag' }))).toEqual(['Hidden Vault Entry']);
  });

  it('rejects an over-long search text and an unknown filter', async () => {
    const tooLong = await operator.client.get<ProblemDetails>(`/accounts?q=${'a'.repeat(101)}`);
    expect(tooLong.status).toBe(422);
    const unknown = await operator.client.get<ProblemDetails>('/accounts?filter=everything');
    expect(unknown.status).toBe(422);
  });
});

describe('password age indicator', () => {
  it('classifies each account by its oldest credential and ignores archived ones', async () => {
    const fresh = await createAccount(operator, 'Age Fresh');
    await addCredential(fresh.id, { rotatedDaysAgo: 10 });
    const aging = await createAccount(operator, 'Age Aging');
    await addCredential(aging.id, { rotatedDaysAgo: 70 });
    const stale = await createAccount(operator, 'Age Stale');
    await addCredential(stale.id, { rotatedDaysAgo: 120 });
    const neverRotated = await createAccount(operator, 'Age Never Rotated');
    await addCredential(neverRotated.id, { createdDaysAgo: 100 });
    const mixed = await createAccount(operator, 'Age Mixed');
    await addCredential(mixed.id, { rotatedDaysAgo: 5 });
    await addCredential(mixed.id, { rotatedDaysAgo: 95 });
    const onlyArchived = await createAccount(operator, 'Age Only Archived');
    await addCredential(onlyArchived.id, { rotatedDaysAgo: 400, archived: true });
    await createAccount(operator, 'Age Empty');

    const items = await search(operator, { q: 'Age ' });
    const statusOf = (name: string): string | undefined =>
      items.find((item) => item.displayName === name)?.passwordAge;
    expect(statusOf('Age Fresh')).toBe('fresh');
    expect(statusOf('Age Aging')).toBe('aging');
    expect(statusOf('Age Stale')).toBe('stale');
    expect(statusOf('Age Never Rotated')).toBe('stale');
    expect(statusOf('Age Mixed')).toBe('stale');
    expect(statusOf('Age Only Archived')).toBe('none');
    expect(statusOf('Age Empty')).toBe('none');

    const stalest = items.find((item) => item.displayName === 'Age Stale');
    expect(stalest?.lastChangedAt).not.toBeNull();
    expect(items.find((item) => item.displayName === 'Age Empty')?.lastChangedAt).toBeNull();
  });

  it('review filter keeps only aging and stale accounts', async () => {
    expect(names(await search(operator, { q: 'Age ', filter: 'review' }))).toEqual([
      'Age Aging',
      'Age Mixed',
      'Age Never Rotated',
      'Age Stale',
    ]);
  });

  it('does not show the age of an account to someone without access', async () => {
    expect(names(await search(outsider, { q: 'Age ', filter: 'review' }))).toEqual([]);
  });
});

describe('quick filter: without 2FA', () => {
  it('lists accounts of TOTP platforms whose live credential has no verified code', async () => {
    const missing = await createAccount(operator, 'Totp Missing', { platformId: totpPlatformId });
    await addCredential(missing.id, { rotatedDaysAgo: 1 });
    const covered = await createAccount(operator, 'Totp Covered', { platformId: totpPlatformId });
    await verifyTotp(await addCredential(covered.id, { rotatedDaysAgo: 1 }));

    const items = await search(operator, { q: 'Totp ', filter: 'no-2fa' });
    expect(names(items)).toEqual(['Totp Missing']);
  });
});

describe('inventory', () => {
  it('supports text search but reveals nothing about credentials', async () => {
    const items = await search(admin, { q: 'Age Stale' }, '/accounts/inventory');
    expect(names(items)).toEqual(['Age Stale']);
    expect(items[0]?.myLevel).toBeNull();
    // «Age Stale» sí tiene credenciales: el inventario no debe mostrar ni su fecha ni su semáforo.
    expect(items[0]?.passwordAge).toBe('unknown');
    expect(items[0]?.lastChangedAt).toBeNull();
  });

  it('rejects the quick filters instead of ignoring them', async () => {
    for (const filter of ['review', 'no-2fa']) {
      const response = await admin.client.get<ProblemDetails>(
        `/accounts/inventory?filter=${filter}`,
      );
      expect(response.status).toBe(422);
    }
  });

  it('denies the inventory to someone without the inventory permission', async () => {
    const response = await operator.client.get<ProblemDetails>('/accounts/inventory?q=Age');
    expect(response.status).toBe(403);
  });
});

describe('access boundary with mixed accounts', () => {
  it('returns only the accounts shared with the person, and none after the share is revoked', async () => {
    const shared = await createAccount(operator, 'Boundary Shared');
    await createAccount(operator, 'Boundary Private');

    const granted = await operator.client.post<{ id: string }>(`/accounts/${shared.id}/shares`, {
      granteeType: 'user',
      granteeId: await userId('outsider@search.test'),
      level: 'VIEW',
    });
    expect(granted.status).toBe(201);

    expect(names(await search(outsider, { q: 'Boundary' }))).toEqual(['Boundary Shared']);
    expect(names(await search(operator, { q: 'Boundary' }))).toEqual([
      'Boundary Private',
      'Boundary Shared',
    ]);

    const revoked = await operator.client.post(
      `/accounts/${shared.id}/shares/${granted.body.id}/revoke`,
    );
    expect(revoked.status).toBe(204);
    expect(names(await search(outsider, { q: 'Boundary' }))).toEqual([]);
  });

  it('keeps search and filters consistent across pages of the cursor', async () => {
    // El contrato solo admite páginas de 10, 25, 50 o 100: 12 cuentas obligan a usar dos páginas.
    const expectedNames: string[] = [];
    for (let index = 1; index <= 12; index += 1) {
      const name = `Page Probe ${String(index).padStart(2, '0')}`;
      const account = await createAccount(operator, name);
      await addCredential(account.id, { rotatedDaysAgo: 70 });
      expectedNames.push(name);
    }
    await createAccount(operator, 'Page Probe Fresh');

    const collected: string[] = [];
    let cursor: string | null = null;
    let pagesRead = 0;
    do {
      const query: Record<string, string> = { q: 'Page Probe', filter: 'review', limit: '10' };
      if (cursor !== null) query['cursor'] = cursor;
      const response = await operator.client.get<Page>(
        `/accounts?${new URLSearchParams(query).toString()}`,
      );
      expect(response.status).toBe(200);
      collected.push(...names(response.body.data));
      cursor = response.body.page.nextCursor;
      pagesRead += 1;
    } while (cursor !== null && pagesRead < 5);

    expect(pagesRead).toBe(2);
    expect(collected).toEqual(expectedNames);
  });
});
