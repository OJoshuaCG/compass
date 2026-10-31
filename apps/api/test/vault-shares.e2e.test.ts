import { Writable } from 'node:stream';

import type {
  Account,
  Credential,
  ProblemDetails,
  RevealedPassword,
  Role,
  Share,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B3: compartir y revocar cuentas por persona y por grupo, con caducidad, techo de nivel y
// tarea de rotación al revocar a quien reveló una contraseña.
const DENIAL_GROUPING_WINDOW_MS = 61_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const VALID_REASON = 'Rotating the shared login for the brand page';

const capturedLines: string[] = [];
const logDestination = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    capturedLines.push(chunk.toString('utf8'));
    callback();
  },
});

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let owner: EnrolledSession;
let revealer: EnrolledSession;
let colleague: EnrolledSession;
let editor: EnrolledSession;
let stranger: EnrolledSession;
let instagramId: string;

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const newAccount = async (displayName: string): Promise<Account> => {
  const created = await owner.client.post<Account>('/accounts', {
    platformId: instagramId,
    displayName,
  });
  expect(created.status).toBe(201);
  return created.body;
};

const newGroup = async (name: string, memberEmails: readonly string[]): Promise<string> => {
  const creator = await userId('root@shares.test');
  const group = await env.db.admin.query<{ id: string }>(
    'insert into groups (organization_id, name, created_by) values ($1, $2, $3) returning id',
    [orgId, name, creator],
  );
  const groupId = group.rows[0]?.id ?? '';
  for (const email of memberEmails) {
    await env.db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [orgId, groupId, await userId(email), creator],
    );
  }
  return groupId;
};

const shareToUser = async (
  who: EnrolledSession,
  accountId: string,
  email: string,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
  expiresAt?: string,
) =>
  who.client.post<Share & ProblemDetails>(`/accounts/${accountId}/shares`, {
    granteeType: 'user',
    granteeId: await userId(email),
    level,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });

const shareToGroup = (
  who: EnrolledSession,
  accountId: string,
  groupId: string,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
) =>
  who.client.post<Share & ProblemDetails>(`/accounts/${accountId}/shares`, {
    granteeType: 'group',
    granteeId: groupId,
    level,
  });

const revokeShare = (who: EnrolledSession, accountId: string, shareId: string) =>
  who.client.post<ProblemDetails>(`/accounts/${accountId}/shares/${shareId}/revoke`);

const canSee = async (who: EnrolledSession, accountId: string): Promise<boolean> => {
  const response = await who.client.get(`/accounts/${accountId}`);
  return response.status === 200;
};

const revealOnce = async (who: EnrolledSession, credentialId: string): Promise<void> => {
  const reauth = await who.client.post('/auth/reauth', {
    code: freshTotp(who.secret, env.clock),
  });
  expect(reauth.status).toBe(204);
  const revealed = await who.client.post<RevealedPassword>(`/credentials/${credentialId}/reveal`, {
    reason: VALID_REASON,
  });
  expect(revealed.status).toBe(200);
};

const rotationTasks = async (credentialId: string) =>
  (
    await env.db.admin.query<{
      trigger: string;
      assigned_to: string;
      triggered_by_user: string | null;
      priority: string;
      status: string;
    }>(
      `select trigger, assigned_to, triggered_by_user, priority, status
         from rotation_tasks where organization_id = $1 and credential_id = $2`,
      [orgId, credentialId],
    )
  ).rows;

const auditRows = async (action: string) =>
  (
    await env.db.admin.query<{
      target_id: string | null;
      reason_code: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select target_id, reason_code, metadata from audit_events
        where organization_id = $1 and action = $2 order by seq`,
      [orgId, action],
    )
  ).rows;

const inDays = (days: number): string =>
  new Date(env.clock.now().getTime() + days * MILLISECONDS_PER_DAY).toISOString();

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { logDestination });
  const created = await env.bootstrapOrganization({
    slug: 'shares',
    rootEmail: 'root@shares.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.90');
  await rootClient.post('/auth/login', { email: 'root@shares.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';
  const invite = (email: string, rank: 1 | 2 | 3, roleName: string) =>
    inviteAndOnboard(env, root.client, { email, rank, roleIds: [roleId(roleName)] });

  owner = await invite('owner@shares.test', 3, 'Operator');
  revealer = await invite('revealer@shares.test', 2, 'Leader');
  colleague = await invite('colleague@shares.test', 2, 'Leader');
  editor = await invite('editor@shares.test', 2, 'Leader');
  stranger = await invite('stranger@shares.test', 2, 'Leader');

  const platforms = await owner.client.get<{ data: { id: string; slug: string }[] }>('/platforms');
  instagramId = platforms.body.data.find((platform) => platform.slug === 'instagram')?.id ?? '';
});

afterAll(async () => {
  await env.close();
});

describe('sharing with a person', () => {
  it('gives access at the chosen level, lists it, and audits it', async () => {
    const account = await newAccount('Shared with a person');
    expect(await canSee(colleague, account.id)).toBe(false);

    const shared = await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW');
    expect(shared.status).toBe(201);
    expect(shared.body.level).toBe('VIEW');
    expect(shared.body.granteeType).toBe('user');
    expect(await canSee(colleague, account.id)).toBe(true);

    const listed = await owner.client.get<{ data: Share[] }>(`/accounts/${account.id}/shares`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((share) => share.id)).toContain(shared.body.id);

    const events = (await auditRows('share.granted')).filter((row) => row.target_id === account.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      level: 'VIEW',
      granteeType: 'user',
      granteeId: await userId('colleague@shares.test'),
      expiresAt: null,
    });
  });

  it('rejects sharing again with someone who already has access', async () => {
    const account = await newAccount('Shared twice');
    expect((await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW')).status).toBe(
      201,
    );
    const again = await shareToUser(owner, account.id, 'colleague@shares.test', 'EDIT');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SHARE.ALREADY_EXISTS');
  });

  it('rejects yourself, an unknown person, an inactive person and an archived group', async () => {
    const account = await newAccount('Invalid grantees');

    const toSelf = await shareToUser(owner, account.id, 'owner@shares.test', 'VIEW');
    expect(toSelf.status).toBe(422);
    expect(toSelf.body.code).toBe('SHARE.GRANTEE_INVALID');

    const unknown = await owner.client.post<ProblemDetails>(`/accounts/${account.id}/shares`, {
      granteeType: 'user',
      granteeId: '019a0000-0000-7000-8000-000000000000',
      level: 'VIEW',
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('SHARE.GRANTEE_INVALID');

    const archivedGroupId = await newGroup('Archived group', []);
    await env.db.admin.query('update groups set archived_at = now() where id = $1', [
      archivedGroupId,
    ]);
    const toArchived = await shareToGroup(owner, account.id, archivedGroupId, 'VIEW');
    expect(toArchived.status).toBe(422);
    expect(toArchived.body.code).toBe('SHARE.GRANTEE_INVALID');
  });

  it('requires an expiry in the future and within a year', async () => {
    const account = await newAccount('Expiry rules');

    const past = await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW', inDays(-1));
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('SHARE.EXPIRY_INVALID');

    const tooFar = await shareToUser(
      owner,
      account.id,
      'colleague@shares.test',
      'VIEW',
      inDays(366),
    );
    expect(tooFar.status).toBe(422);
    expect(tooFar.body.code).toBe('SHARE.EXPIRY_INVALID');

    const valid = await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW', inDays(30));
    expect(valid.status).toBe(201);
    expect(valid.body.expiresAt).not.toBeNull();
  });

  it('stops giving access once the share expires and allows sharing again', async () => {
    const account = await newAccount('Expired share');
    const shared = await shareToUser(
      owner,
      account.id,
      'colleague@shares.test',
      'VIEW',
      inDays(30),
    );
    expect(shared.status).toBe(201);
    expect(await canSee(colleague, account.id)).toBe(true);

    // La vista `effective_access` usa la hora de la base de datos, no el reloj de la prueba.
    await env.db.admin.query(
      "update shares set expires_at = now() - interval '1 minute' where id = $1",
      [shared.body.id],
    );
    expect(await canSee(colleague, account.id)).toBe(false);

    const renewed = await shareToUser(owner, account.id, 'colleague@shares.test', 'EDIT');
    expect(renewed.status).toBe(201);
    expect(await canSee(colleague, account.id)).toBe(true);
    const expiredRow = await env.db.admin.query<{ revoked_at: Date | null }>(
      'select revoked_at from shares where id = $1',
      [shared.body.id],
    );
    expect(expiredRow.rows[0]?.revoked_at).not.toBeNull();
  });
});

describe('sharing with a group', () => {
  it('gives every member access and takes it away on revoke', async () => {
    const account = await newAccount('Shared with a group');
    const groupId = await newGroup('Brand team', ['colleague@shares.test', 'revealer@shares.test']);

    const shared = await shareToGroup(owner, account.id, groupId, 'VIEW');
    expect(shared.status).toBe(201);
    expect(shared.body.granteeType).toBe('group');
    expect(await canSee(colleague, account.id)).toBe(true);
    expect(await canSee(revealer, account.id)).toBe(true);
    expect(await canSee(stranger, account.id)).toBe(false);

    const revoked = await revokeShare(owner, account.id, shared.body.id);
    expect(revoked.status).toBe(204);
    expect(await canSee(colleague, account.id)).toBe(false);
    expect(await canSee(revealer, account.id)).toBe(false);
  });
});

describe('who can manage shares', () => {
  it('denies EDIT with AUTHZ.SHARE and audits it, and hides the account from strangers', async () => {
    const account = await newAccount('Share management');
    expect((await shareToUser(owner, account.id, 'editor@shares.test', 'EDIT')).status).toBe(201);

    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    const before = (await auditRows('authz.denied')).length;
    const denied = await shareToUser(editor, account.id, 'colleague@shares.test', 'VIEW');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTHZ.SHARE');
    const denials = await auditRows('authz.denied');
    expect(denials.length).toBe(before + 1);
    expect(denials.at(-1)?.reason_code).toBe('AUTHZ.SHARE');

    const deniedList = await editor.client.get<ProblemDetails>(`/accounts/${account.id}/shares`);
    expect(deniedList.status).toBe(403);

    const hidden = await shareToUser(stranger, account.id, 'colleague@shares.test', 'VIEW');
    expect(hidden.status).toBe(404);
    const hiddenList = await stranger.client.get<ProblemDetails>(`/accounts/${account.id}/shares`);
    expect(hiddenList.status).toBe(404);
  });
});

describe('revoking a share', () => {
  it('cuts access from the next request and audits it', async () => {
    const account = await newAccount('Revoked share');
    const shared = await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW');
    expect(await canSee(colleague, account.id)).toBe(true);

    const revoked = await revokeShare(owner, account.id, shared.body.id);
    expect(revoked.status).toBe(204);
    expect(await canSee(colleague, account.id)).toBe(false);

    const again = await revokeShare(owner, account.id, shared.body.id);
    expect(again.status).toBe(404);

    const events = (await auditRows('share.revoked')).filter((row) => row.target_id === account.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      level: 'VIEW',
      granteeType: 'user',
      rotationTasks: 0,
    });
  });

  it('creates one rotation task for a password the revoked person revealed', async () => {
    const account = await newAccount('Rotation after reveal');
    const credential = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
      label: 'Main login',
      username: 'rotation-user@brand.example',
      password: 'Rotation-Canary-Password-5521',
    });
    expect(credential.status).toBe(201);

    const shared = await shareToUser(owner, account.id, 'revealer@shares.test', 'VIEW');
    await revealOnce(revealer, credential.body.id);

    expect((await revokeShare(owner, account.id, shared.body.id)).status).toBe(204);

    const tasks = await rotationTasks(credential.body.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      trigger: 'share_revoked',
      assigned_to: await userId('owner@shares.test'),
      triggered_by_user: await userId('revealer@shares.test'),
      priority: 'high',
      status: 'pending',
    });

    const events = (await auditRows('share.revoked')).filter((row) => row.target_id === account.id);
    expect(events[0]?.metadata).toMatchObject({ rotationTasks: 1 });

    // Compartir y revocar otra vez no duplica la tarea mientras la primera siga abierta.
    const reshared = await shareToUser(owner, account.id, 'revealer@shares.test', 'VIEW');
    expect(reshared.status).toBe(201);
    expect((await revokeShare(owner, account.id, reshared.body.id)).status).toBe(204);
    expect(await rotationTasks(credential.body.id)).toHaveLength(1);
  });

  it('creates no task when the person never revealed the password', async () => {
    const account = await newAccount('No reveal, no rotation');
    const credential = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
      label: 'Main login',
      username: 'no-reveal@brand.example',
      password: 'NoReveal-Canary-Password-3310',
    });
    expect(credential.status).toBe(201);

    const shared = await shareToUser(owner, account.id, 'colleague@shares.test', 'VIEW');
    expect((await revokeShare(owner, account.id, shared.body.id)).status).toBe(204);
    expect(await rotationTasks(credential.body.id)).toHaveLength(0);
  });

  it('creates no task for a credential that was archived after the reveal', async () => {
    const account = await newAccount('Archived credential');
    const credential = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
      label: 'Old login',
      username: 'archived-user@brand.example',
      password: 'Archived-Canary-Password-6612',
    });
    expect(credential.status).toBe(201);

    const shared = await shareToUser(owner, account.id, 'revealer@shares.test', 'VIEW');
    await revealOnce(revealer, credential.body.id);
    await env.db.admin.query('update credentials set archived_at = now() where id = $1', [
      credential.body.id,
    ]);

    expect((await revokeShare(owner, account.id, shared.body.id)).status).toBe(204);
    expect(await rotationTasks(credential.body.id)).toHaveLength(0);
  });

  it('creates no task when the person still has access through a group', async () => {
    const account = await newAccount('Access through a group');
    const credential = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
      label: 'Main login',
      username: 'group-user@brand.example',
      password: 'GroupUser-Canary-Password-8843',
    });
    expect(credential.status).toBe(201);

    const groupId = await newGroup('Still has access', ['revealer@shares.test']);
    expect((await shareToGroup(owner, account.id, groupId, 'VIEW')).status).toBe(201);
    const direct = await shareToUser(owner, account.id, 'revealer@shares.test', 'VIEW');
    expect(direct.status).toBe(201);
    await revealOnce(revealer, credential.body.id);

    expect((await revokeShare(owner, account.id, direct.body.id)).status).toBe(204);
    expect(await canSee(revealer, account.id)).toBe(true);
    expect(await rotationTasks(credential.body.id)).toHaveLength(0);
  });
});

describe('logging', () => {
  it('never writes secrets to the log', () => {
    const everything = capturedLines.join('');
    expect(everything).not.toContain('Rotation-Canary-Password-5521');
    expect(everything).not.toContain('GroupUser-Canary-Password-8843');
  });
});
