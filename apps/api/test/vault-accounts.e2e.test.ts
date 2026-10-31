import type { Account, ProblemDetails, Role } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B1: cuentas de la bóveda. Dos llaves (permiso del catálogo + nivel de acceso a la cuenta),
// acceso efectivo calculado en SQL, inventario sin acceso, archivado que revoca y aislamiento.
const DENIAL_GROUPING_WINDOW_MS = 61_000;
const PAGE_LIMIT = 10;
const ACCOUNTS_FOR_PAGINATION = 12;

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let admin: EnrolledSession;
let leader: EnrolledSession;
let operator: EnrolledSession;
let otherOperator: EnrolledSession;
let outsider: EnrolledSession;
let withoutRole: EnrolledSession;
let instagramId: string;

interface Page {
  data: Account[];
  page: { nextCursor: string | null; limit: number };
}

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const share = async (
  accountId: string,
  granteeType: 'user' | 'group',
  granteeId: string,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
  options: { expiresAt?: string; revoked?: boolean } = {},
): Promise<void> => {
  const grantor = await userId('root@vault.test');
  await env.db.admin.query(
    `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level,
                         granted_by, expires_at, revoked_at, revoked_by)
     values ($1, 'account', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      orgId,
      accountId,
      granteeType,
      granteeId,
      level,
      grantor,
      options.expiresAt ?? null,
      options.revoked === true ? new Date().toISOString() : null,
      options.revoked === true ? grantor : null,
    ],
  );
};

const createGroup = async (name: string, memberEmail: string): Promise<string> => {
  const creator = await userId('root@vault.test');
  const group = await env.db.admin.query<{ id: string }>(
    'insert into groups (organization_id, name, created_by) values ($1, $2, $3) returning id',
    [orgId, name, creator],
  );
  const groupId = group.rows[0]?.id ?? '';
  await env.db.admin.query(
    "insert into group_memberships (organization_id, group_id, user_id, role, added_by) values ($1, $2, $3, 'member', $4)",
    [orgId, groupId, await userId(memberEmail), creator],
  );
  return groupId;
};

const createAccount = async (
  session: EnrolledSession,
  displayName: string,
  extra: Record<string, unknown> = {},
): Promise<Account> => {
  const response = await session.client.post<Account>('/accounts', {
    platformId: instagramId,
    displayName,
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body;
};

const auditRows = async (action: string) =>
  (
    await env.db.admin.query<{
      actor_id: string | null;
      target_id: string | null;
      reason_code: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      'select actor_id, target_id, reason_code, outcome, metadata from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

const leaveDenialGroupingWindow = (): void => {
  env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'vault',
    rootEmail: 'root@vault.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.70');
  await rootClient.post('/auth/login', { email: 'root@vault.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';

  admin = await inviteAndOnboard(env, root.client, {
    email: 'admin@vault.test',
    rank: 1,
    roleIds: [roleId('Administrator')],
  });
  leader = await inviteAndOnboard(env, root.client, {
    email: 'leader@vault.test',
    rank: 2,
    roleIds: [roleId('Leader')],
  });
  operator = await inviteAndOnboard(env, root.client, {
    email: 'operator@vault.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });
  otherOperator = await inviteAndOnboard(env, root.client, {
    email: 'other@vault.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });
  outsider = await inviteAndOnboard(env, root.client, {
    email: 'outsider@vault.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });
  withoutRole = await inviteAndOnboard(env, root.client, {
    email: 'norole@vault.test',
    rank: 3,
  });

  const platforms = await operator.client.get<{ data: { id: string; slug: string }[] }>(
    '/platforms',
  );
  instagramId = platforms.body.data.find((platform) => platform.slug === 'instagram')?.id ?? '';
});

afterAll(async () => {
  await env.close();
});

describe('platform catalog', () => {
  it('lists the global catalog to any active member and rejects anonymous calls', async () => {
    const response = await withoutRole.client.get<{
      data: { slug: string; isGlobal: boolean }[];
    }>('/platforms');
    expect(response.status).toBe(200);
    expect(response.body.data.map((platform) => platform.slug)).toContain('instagram');
    expect(response.body.data.every((platform) => platform.isGlobal)).toBe(true);

    expect((await new TestClient(env, '203.0.113.71').get('/platforms')).status).toBe(401);
  });
});

describe('creating accounts', () => {
  it('gives the creator a direct MANAGE share and audits it', async () => {
    const account = await createAccount(operator, 'Brand Instagram', {
      handle: '@brand',
      tags: ['brand', 'brand', 'social'],
    });

    expect(account.myLevel).toBe('MANAGE');
    expect(account.tags).toEqual(['brand', 'social']);
    const shares = await env.db.admin.query<{ level: string; grantee_id: string }>(
      'select level, grantee_id from shares where resource_id = $1 and revoked_at is null',
      [account.id],
    );
    expect(shares.rows).toEqual([
      { level: 'MANAGE', grantee_id: await userId('operator@vault.test') },
    ]);

    const events = (await auditRows('account.created')).filter(
      (row) => row.target_id === account.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ platformId: instagramId, hasOwnerGroup: false });
  });

  it('rejects an unknown platform and an unknown group', async () => {
    const unknownPlatform = await operator.client.post<ProblemDetails>('/accounts', {
      platformId: '0197a000-0000-7000-8000-000000000000',
      displayName: 'X',
    });
    expect(unknownPlatform.status).toBe(422);
    expect(unknownPlatform.body.code).toBe('ACCOUNT.PLATFORM_INVALID');

    const unknownGroup = await operator.client.post<ProblemDetails>('/accounts', {
      platformId: instagramId,
      displayName: 'X',
      ownerGroupId: '0197a000-0000-7000-8000-000000000000',
    });
    expect(unknownGroup.status).toBe(422);
    expect(unknownGroup.body.code).toBe('ACCOUNT.GROUP_INVALID');
  });

  it('validates the body at the boundary', async () => {
    const empty = await operator.client.post('/accounts', {
      platformId: instagramId,
      displayName: '  ',
    });
    expect(empty.status).toBe(422);
    const noPlatform = await operator.client.post('/accounts', { displayName: 'X' });
    expect(noPlatform.status).toBe(422);
  });
});

describe('effective access', () => {
  it('shows an account only to people who have a live share', async () => {
    const account = await createAccount(operator, 'Private account');

    const mine = (await operator.client.get<Page>('/accounts')).body.data;
    expect(mine.map((item) => item.id)).toContain(account.id);

    const theirs = (await otherOperator.client.get<Page>('/accounts')).body.data;
    expect(theirs.map((item) => item.id)).not.toContain(account.id);
    expect((await otherOperator.client.get(`/accounts/${account.id}`)).status).toBe(404);
  });

  it('inherits the level from a group and keeps the highest of direct and group grants', async () => {
    const account = await createAccount(operator, 'Group account');
    const groupId = await createGroup('Social team', 'other@vault.test');
    await share(account.id, 'group', groupId, 'VIEW');

    const viaGroup = await otherOperator.client.get<Account>(`/accounts/${account.id}`);
    expect(viaGroup.status).toBe(200);
    expect(viaGroup.body.myLevel).toBe('VIEW');

    await share(account.id, 'user', await userId('other@vault.test'), 'EDIT');
    const both = await otherOperator.client.get<Account>(`/accounts/${account.id}`);
    expect(both.body.myLevel).toBe('EDIT');
  });

  it('ignores revoked shares, expired shares and archived groups', async () => {
    const account = await createAccount(operator, 'Lapsed account');
    await share(account.id, 'user', await userId('outsider@vault.test'), 'VIEW', {
      revoked: true,
    });
    expect((await outsider.client.get(`/accounts/${account.id}`)).status).toBe(404);

    const expired = await createAccount(operator, 'Expired account');
    await share(expired.id, 'user', await userId('outsider@vault.test'), 'VIEW', {
      expiresAt: '2000-01-01T00:00:00Z',
    });
    expect((await outsider.client.get(`/accounts/${expired.id}`)).status).toBe(404);

    const viaArchivedGroup = await createAccount(operator, 'Archived group account');
    const groupId = await createGroup('Closed team', 'outsider@vault.test');
    await share(viaArchivedGroup.id, 'group', groupId, 'MANAGE');
    expect((await outsider.client.get(`/accounts/${viaArchivedGroup.id}`)).status).toBe(200);
    await env.db.admin.query('update groups set archived_at = now() where id = $1', [groupId]);
    expect((await outsider.client.get(`/accounts/${viaArchivedGroup.id}`)).status).toBe(404);

    const listed = (await outsider.client.get<Page>('/accounts')).body.data.map((item) => item.id);
    expect(listed).not.toContain(account.id);
    expect(listed).not.toContain(expired.id);
    expect(listed).not.toContain(viaArchivedGroup.id);
  });

  it('never grants access because of rank or permissions: Root and Administrator get 404', async () => {
    const account = await createAccount(operator, 'Rank is not access');
    expect((await root.client.get(`/accounts/${account.id}`)).status).toBe(404);
    expect((await admin.client.get(`/accounts/${account.id}`)).status).toBe(404);
    expect(
      (await root.client.get<Page>('/accounts')).body.data.map((item) => item.id),
    ).not.toContain(account.id);
  });
});

describe('editing accounts', () => {
  it('needs EDIT: VIEW is denied with AUTHZ.SHARE and audited, no access is 404', async () => {
    const account = await createAccount(operator, 'To edit');
    await share(account.id, 'user', await userId('other@vault.test'), 'VIEW');

    leaveDenialGroupingWindow();
    const before = (await auditRows('authz.denied')).length;
    const denied = await otherOperator.client.patch<ProblemDetails>(`/accounts/${account.id}`, {
      displayName: 'Hijacked',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTHZ.SHARE');
    const denials = await auditRows('authz.denied');
    expect(denials.length).toBe(before + 1);
    expect(denials.at(-1)?.reason_code).toBe('AUTHZ.SHARE');
    // La negación nombra la cuenta: sin eso no se sabría a cuál se apuntó.
    expect(denials.at(-1)?.target_id).toBe(account.id);

    // Dentro de la misma ventana, una cuenta distinta no se colapsa en el evento anterior.
    const secondAccount = await createAccount(operator, 'To edit too');
    await share(secondAccount.id, 'user', await userId('other@vault.test'), 'VIEW');
    const deniedOnSecond = await otherOperator.client.patch<ProblemDetails>(
      `/accounts/${secondAccount.id}`,
      { displayName: 'Hijacked' },
    );
    expect(deniedOnSecond.status).toBe(403);
    const denialsAfterSecond = await auditRows('authz.denied');
    expect(denialsAfterSecond.length).toBe(before + 2);
    expect(denialsAfterSecond.at(-1)?.target_id).toBe(secondAccount.id);

    const hidden = await outsider.client.patch<ProblemDetails>(`/accounts/${account.id}`, {
      displayName: 'Hijacked',
    });
    expect(hidden.status).toBe(404);

    const unchanged = await operator.client.get<Account>(`/accounts/${account.id}`);
    expect(unchanged.body.displayName).toBe('To edit');
  });

  it('applies a partial edit, clears optional values and audits only the field names', async () => {
    const account = await createAccount(operator, 'Editable', { handle: '@old', tags: ['a'] });

    const response = await operator.client.patch<Account>(`/accounts/${account.id}`, {
      displayName: 'Renamed',
      handle: null,
      tags: ['b'],
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      displayName: 'Renamed',
      handle: null,
      tags: ['b'],
      myLevel: 'MANAGE',
    });

    const events = (await auditRows('account.updated')).filter(
      (row) => row.target_id === account.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ changedFields: 'displayName,handle,tags' });
  });

  it('rejects an empty edit and an archived group', async () => {
    const account = await createAccount(operator, 'Validated');
    expect((await operator.client.patch(`/accounts/${account.id}`, {})).status).toBe(422);

    const groupId = await createGroup('Dead team', 'operator@vault.test');
    await env.db.admin.query('update groups set archived_at = now() where id = $1', [groupId]);
    const response = await operator.client.patch<ProblemDetails>(`/accounts/${account.id}`, {
      ownerGroupId: groupId,
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ACCOUNT.GROUP_INVALID');
  });
});

describe('archiving accounts', () => {
  it('needs the permission (the Operator lacks it) and then MANAGE on the account', async () => {
    const account = await createAccount(operator, 'To archive');

    const byOperator = await operator.client.post<ProblemDetails>(
      `/accounts/${account.id}/archive`,
    );
    expect(byOperator.status).toBe(403);
    expect(byOperator.body.code).toBe('AUTHZ.PERMISSION');

    await share(account.id, 'user', await userId('leader@vault.test'), 'EDIT');
    const byEditor = await leader.client.post<ProblemDetails>(`/accounts/${account.id}/archive`);
    expect(byEditor.status).toBe(403);
    expect(byEditor.body.code).toBe('AUTHZ.SHARE');
  });

  it('revokes every share in the same transaction, keeps the rows and hides the account', async () => {
    const account = await createAccount(operator, 'Closing account');
    await share(account.id, 'user', await userId('leader@vault.test'), 'MANAGE');
    await share(account.id, 'user', await userId('other@vault.test'), 'VIEW');

    expect((await leader.client.post(`/accounts/${account.id}/archive`)).status).toBe(204);

    const shares = await env.db.admin.query<{ revoked_at: Date | null; revoked_by: string | null }>(
      'select revoked_at, revoked_by from shares where resource_id = $1',
      [account.id],
    );
    expect(shares.rows).toHaveLength(3);
    expect(shares.rows.every((row) => row.revoked_at !== null && row.revoked_by !== null)).toBe(
      true,
    );
    const row = await env.db.admin.query<{ status: string; archived_at: Date | null }>(
      'select status, archived_at from accounts where id = $1',
      [account.id],
    );
    expect(row.rows[0]?.status).toBe('archived');

    const events = (await auditRows('account.archived')).filter(
      (event) => event.target_id === account.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ revokedShares: 3 });

    expect((await operator.client.get(`/accounts/${account.id}`)).status).toBe(404);
    expect(
      (await operator.client.patch(`/accounts/${account.id}`, { displayName: 'Zombie' })).status,
    ).toBe(404);
    expect((await leader.client.post(`/accounts/${account.id}/archive`)).status).toBe(404);
    expect(
      (await operator.client.get<Page>('/accounts')).body.data.map((item) => item.id),
    ).not.toContain(account.id);
  });
});

describe('inventory', () => {
  it('lists the metadata of every active account but grants no access to any', async () => {
    const hidden = await createAccount(otherOperator, 'Inventory only');

    const inventory = await admin.client.get<Page>('/accounts/inventory');
    expect(inventory.status).toBe(200);
    const entry = inventory.body.data.find((item) => item.id === hidden.id);
    expect(entry?.displayName).toBe('Inventory only');
    expect(entry?.myLevel).toBeNull();

    expect((await admin.client.get(`/accounts/${hidden.id}`)).status).toBe(404);
    expect(
      (await admin.client.patch(`/accounts/${hidden.id}`, { displayName: 'Mine now' })).status,
    ).toBe(404);
  });

  it('is denied without vault.inventory.read and excludes archived accounts', async () => {
    leaveDenialGroupingWindow();
    const before = (await auditRows('authz.denied')).length;
    const denied = await operator.client.get<ProblemDetails>('/accounts/inventory');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTHZ.PERMISSION');
    expect((await auditRows('authz.denied')).length).toBe(before + 1);

    const closed = await createAccount(otherOperator, 'Inventory closed');
    await share(closed.id, 'user', await userId('leader@vault.test'), 'MANAGE');
    expect((await leader.client.post(`/accounts/${closed.id}/archive`)).status).toBe(204);
    const names = (await admin.client.get<Page>('/accounts/inventory')).body.data.map(
      (item) => item.displayName,
    );
    expect(names).not.toContain('Inventory closed');
  });
});

describe('pagination', () => {
  it('pages by name with an opaque cursor and survives a tampered one', async () => {
    for (let index = 0; index < ACCOUNTS_FOR_PAGINATION; index += 1) {
      await createAccount(outsider, `Paged ${String(index).padStart(2, '0')}`);
    }
    const first = await outsider.client.get<Page>(`/accounts?limit=${String(PAGE_LIMIT)}`);
    expect(first.body.data).toHaveLength(PAGE_LIMIT);
    expect(first.body.page.nextCursor).not.toBeNull();

    const second = await outsider.client.get<Page>(
      `/accounts?limit=${String(PAGE_LIMIT)}&cursor=${first.body.page.nextCursor ?? ''}`,
    );
    const names = [...first.body.data, ...second.body.data].map((item) => item.displayName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(second.body.page.nextCursor).toBeNull();

    const tampered = await outsider.client.get<Page>('/accounts?cursor=not-a-cursor');
    expect(tampered.status).toBe(200);
  });
});

describe('organization isolation', () => {
  it('another organization sees none of these accounts', async () => {
    const created = await env.bootstrapOrganization({
      slug: 'vault-other',
      rootEmail: 'root@vault-other.test',
      rootName: 'Grace Hopper',
    });
    expect(created.organizationId).not.toBe(orgId);
    const client = new TestClient(env, '203.0.113.72');
    await client.post('/auth/login', {
      email: 'root@vault-other.test',
      password: STRONG_PASSWORD,
    });
    const foreign = await enroll(env, client);

    const account = await createAccount(operator, 'Cross-tenant');
    expect((await foreign.client.get<Page>('/accounts')).body.data).toEqual([]);
    expect((await foreign.client.get(`/accounts/${account.id}`)).status).toBe(404);
    expect(
      (await foreign.client.patch(`/accounts/${account.id}`, { displayName: 'Stolen' })).status,
    ).toBe(404);
    expect((await foreign.client.get<Page>('/accounts/inventory')).body.data).toEqual([]);
  });
});
