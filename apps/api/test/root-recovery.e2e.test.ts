import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { NodeCryptoPrimitives } from '../src/modules/crypto/index.js';
import {
  MailerAdministratorNotifier,
  PgRootRecoveryStore,
  RecoverRoot,
  RootRecoveryRejectedError,
} from '../src/modules/provisioning/index.js';
import type { AdministratorNotifier } from '../src/modules/provisioning/index.js';
import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;

const primitives = new NodeCryptoPrimitives();

// Por construcción del alta (ADR 0037) los índices 0 a 3 son del custodio A y los 4 a 7 del custodio B.
const GROUP_A_INDEX = 0;
const OTHER_GROUP_A_INDEX = 1;
const GROUP_B_INDEX = 4;

function recoverRoot(
  slug: string,
  codes: readonly [string, string],
  notifier?: AdministratorNotifier,
) {
  return new RecoverRoot({
    store: new PgRootRecoveryStore(env.adminPool),
    notifier: notifier ?? new MailerAdministratorNotifier(env.mailer),
    hasher: env.container.hasher,
    strength: env.container.strength,
    primitives: {
      randomBytes: (length) => primitives.randomBytes(length),
      sha256: (data) => primitives.sha256(data),
    },
    now: () => new Date(),
  }).execute({ organizationSlug: slug, presentedCodes: codes });
}

async function newOrganization(slug: string) {
  const created = await env.bootstrapOrganization({
    slug,
    rootEmail: `root@${slug}.test`,
    rootName: 'Ada Lovelace',
  });
  const codeAt = (index: number): string => created.emergencyCodes[index] ?? '';
  return { ...created, slug, codeAt };
}

async function snapshot(organizationId: string, rootUserId: string) {
  const query = async <T extends object>(sql: string, params: unknown[]): Promise<T[]> =>
    (await env.db.admin.query<T>(sql, params)).rows;
  const user = (
    await query<{ status: string }>('select status from users where id = $1', [rootUserId])
  )[0];
  const password = (
    await query<{ argon2_hash: string; must_change: boolean }>(
      'select argon2_hash, must_change from user_passwords where user_id = $1',
      [rootUserId],
    )
  )[0];
  const codes = await query<{ kind: string; used_at: Date | null; custody_group: string | null }>(
    'select kind, used_at, custody_group from user_recovery_codes where user_id = $1',
    [rootUserId],
  );
  const audited = await query<{ metadata: unknown }>(
    "select metadata from audit_events where organization_id = $1 and action = 'auth.root_recovered'",
    [organizationId],
  );
  return {
    status: user?.status,
    passwordHash: password?.argon2_hash,
    mustChange: password?.must_change,
    unusedEmergency: codes.filter((c) => c.kind === 'emergency' && c.used_at === null),
    usedEmergency: codes.filter((c) => c.kind === 'emergency' && c.used_at !== null),
    audited: audited.map((row) => row.metadata),
  };
}

type RootSnapshot = Awaited<ReturnType<typeof snapshot>>;

// Compara contra el estado previo al intento y no contra un valor fijo: una Raíz recién dada de alta
// está `invited` (debe cambiar la contraseña inicial), una que ya entró está `active`.
async function expectUntouched(
  organization: { organizationId: string; rootUserId: string },
  before: RootSnapshot,
) {
  const state = await snapshot(organization.organizationId, organization.rootUserId);
  expect(state.status).toBe(before.status);
  expect(state.passwordHash).toBe(before.passwordHash);
  expect(state.mustChange).toBe(before.mustChange);
  expect(state.unusedEmergency).toHaveLength(8);
  expect(state.usedEmergency).toHaveLength(0);
  expect(state.audited).toHaveLength(0);
}

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
});

afterAll(async () => {
  await env.close();
});

describe('recovering the Root with the dual control of the custodians (ADR 0037)', () => {
  it('one code of each custodian recovers the Root: factors, sessions and codes are reset', async () => {
    const organization = await newOrganization('rr-ok');
    const login = new TestClient(env, '203.0.113.50');
    expect(
      (await login.post('/auth/login', { email: 'root@rr-ok.test', password: STRONG_PASSWORD }))
        .status,
    ).toBe(200);
    const root: EnrolledSession = await enroll(env, login);
    await inviteAndOnboard(env, root.client, { email: 'admin@rr-ok.test', rank: 1 });
    const before = await snapshot(organization.organizationId, organization.rootUserId);

    const result = await recoverRoot(organization.slug, [
      organization.codeAt(GROUP_A_INDEX),
      organization.codeAt(GROUP_B_INDEX),
    ]);

    const after = await snapshot(organization.organizationId, organization.rootUserId);
    expect(after.status).toBe('invited');
    expect(after.mustChange).toBe(true);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(
      await env.container.hasher.verify(after.passwordHash ?? '', result.initialPassword),
    ).toBe(true);

    const liveFactors = await env.db.admin.query(
      'select 1 from user_totp_factors where user_id = $1 and revoked_at is null',
      [organization.rootUserId],
    );
    expect(liveFactors.rows).toHaveLength(0);
    const liveSessions = await env.db.admin.query(
      'select 1 from sessions where user_id = $1 and revoked_at is null',
      [organization.rootUserId],
    );
    expect(liveSessions.rows).toHaveLength(0);
    const liveRecoveryCodes = await env.db.admin.query(
      "select 1 from user_recovery_codes where user_id = $1 and kind = 'recovery' and used_at is null",
      [organization.rootUserId],
    );
    expect(liveRecoveryCodes.rows).toHaveLength(0);

    // Los ocho códigos anteriores quedan invalidados y nacen ocho nuevos, cuatro por custodio.
    expect(after.usedEmergency).toHaveLength(8);
    expect(after.unusedEmergency).toHaveLength(8);
    expect(after.unusedEmergency.filter((c) => c.custody_group === 'A')).toHaveLength(4);
    expect(after.unusedEmergency.filter((c) => c.custody_group === 'B')).toHaveLength(4);
    expect(result.emergencyCodes).toHaveLength(8);
    expect(result.emergencyCodes).not.toContain(organization.codeAt(GROUP_A_INDEX));
  });

  it('is audited as critical without secrets, and alerts every active Administrator', async () => {
    const organization = await newOrganization('rr-audit');
    const login = new TestClient(env, '203.0.113.51');
    await login.post('/auth/login', { email: 'root@rr-audit.test', password: STRONG_PASSWORD });
    const root = await enroll(env, login);
    await inviteAndOnboard(env, root.client, { email: 'admin@rr-audit.test', rank: 1 });
    env.mailer.alerts.length = 0;

    const result = await recoverRoot(organization.slug, [
      organization.codeAt(GROUP_B_INDEX),
      organization.codeAt(GROUP_A_INDEX),
    ]);

    const after = await snapshot(organization.organizationId, organization.rootUserId);
    expect(after.audited).toEqual([{ codesIssued: 8, alertRecipients: 1 }]);
    expect(JSON.stringify(after.audited)).not.toContain(result.initialPassword);
    expect(env.mailer.alerts.map((alert) => alert.to)).toEqual(['admin@rr-audit.test']);
    expect(result.alert).toEqual({ recipients: 1, failed: 0 });
  });

  it('a failed alert does not undo the recovery, but is audited as incomplete', async () => {
    const organization = await newOrganization('rr-alert');
    const failing: AdministratorNotifier = {
      notify: (administrators) => Promise.resolve(administrators.length),
    };

    const result = await recoverRoot(
      organization.slug,
      [organization.codeAt(GROUP_A_INDEX), organization.codeAt(GROUP_B_INDEX)],
      failing,
    );

    expect((await snapshot(organization.organizationId, organization.rootUserId)).status).toBe(
      'invited',
    );
    const incomplete = await env.db.admin.query<{ outcome: string }>(
      "select outcome from audit_events where organization_id = $1 and action = 'auth.emergency_alert_incomplete'",
      [organization.organizationId],
    );
    expect(incomplete.rows.map((row) => row.outcome)).toEqual(['failure']);
    expect(result.alert.recipients).toBe(0);
  });

  it('two codes of the SAME custodian are refused and nothing changes (a single custodian cannot act alone)', async () => {
    const organization = await newOrganization('rr-same');
    const before = await snapshot(organization.organizationId, organization.rootUserId);

    await expect(
      recoverRoot(organization.slug, [
        organization.codeAt(GROUP_A_INDEX),
        organization.codeAt(OTHER_GROUP_A_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    await expectUntouched(organization, before);
  });

  it('a code that was already used is refused and nothing changes', async () => {
    const organization = await newOrganization('rr-used');
    await recoverRoot(organization.slug, [
      organization.codeAt(GROUP_A_INDEX),
      organization.codeAt(GROUP_B_INDEX),
    ]);
    const afterFirst = await snapshot(organization.organizationId, organization.rootUserId);

    await expect(
      recoverRoot(organization.slug, [
        organization.codeAt(GROUP_A_INDEX),
        organization.codeAt(GROUP_B_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    const afterReplay = await snapshot(organization.organizationId, organization.rootUserId);
    expect(afterReplay.passwordHash).toBe(afterFirst.passwordHash);
    expect(afterReplay.audited).toHaveLength(1);
  });

  it('an invented code, or the same code twice, is refused and nothing changes', async () => {
    const organization = await newOrganization('rr-invented');
    const before = await snapshot(organization.organizationId, organization.rootUserId);

    await expect(
      recoverRoot(organization.slug, [organization.codeAt(GROUP_A_INDEX), 'ZZZZ-ZZZZ-ZZZZ']),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);
    await expect(
      recoverRoot(organization.slug, [
        organization.codeAt(GROUP_A_INDEX),
        organization.codeAt(GROUP_A_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    await expectUntouched(organization, before);
  });

  it('an ordinary recovery code is never a custodian code', async () => {
    const organization = await newOrganization('rr-ordinary');
    const login = new TestClient(env, '203.0.113.52');
    await login.post('/auth/login', { email: 'root@rr-ordinary.test', password: STRONG_PASSWORD });
    const root = await enroll(env, login);

    await expect(
      recoverRoot(organization.slug, [
        root.recoveryCodes[0] ?? '',
        organization.codeAt(GROUP_B_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    expect((await snapshot(organization.organizationId, organization.rootUserId)).status).toBe(
      'active',
    );
  });

  it('codes of ANOTHER organization are refused and change neither organization', async () => {
    const target = await newOrganization('rr-target');
    const other = await newOrganization('rr-other');
    const targetBefore = await snapshot(target.organizationId, target.rootUserId);
    const otherBefore = await snapshot(other.organizationId, other.rootUserId);

    await expect(
      recoverRoot(target.slug, [other.codeAt(GROUP_A_INDEX), other.codeAt(GROUP_B_INDEX)]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    await expectUntouched(target, targetBefore);
    await expectUntouched(other, otherBefore);
  });

  it('emergency codes without a custody group (created before the ADR) cannot satisfy the dual control', async () => {
    const organization = await newOrganization('rr-legacy');
    await env.adminPool.query(
      "update user_recovery_codes set custody_group = null where user_id = $1 and kind = 'emergency'",
      [organization.rootUserId],
    );
    const before = await snapshot(organization.organizationId, organization.rootUserId);

    await expect(
      recoverRoot(organization.slug, [
        organization.codeAt(GROUP_A_INDEX),
        organization.codeAt(GROUP_B_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    await expectUntouched(organization, before);
  });

  it('a refused attempt on an existing Root is audited as denied, without any secret', async () => {
    const organization = await newOrganization('rr-denied');

    await expect(
      recoverRoot(organization.slug, [organization.codeAt(GROUP_A_INDEX), 'ZZZZ-ZZZZ-ZZZZ']),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    const denied = await env.adminPool.query<{ outcome: string; metadata: unknown }>(
      "select outcome, metadata from audit_events where organization_id = $1 and action = 'auth.root_recovery_rejected'",
      [organization.organizationId],
    );
    expect(denied.rows).toEqual([{ outcome: 'denied', metadata: {} }]);
  });

  it('a suspended Root is not reactivated by the recovery', async () => {
    const organization = await newOrganization('rr-suspended');
    await env.adminPool.query("update users set status = 'suspended' where id = $1", [
      organization.rootUserId,
    ]);
    const before = await snapshot(organization.organizationId, organization.rootUserId);

    await expect(
      recoverRoot(organization.slug, [
        organization.codeAt(GROUP_A_INDEX),
        organization.codeAt(GROUP_B_INDEX),
      ]),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    await expectUntouched(organization, before);
    expect(before.status).toBe('suspended');
  });

  it('an unknown organization is refused with the same error', async () => {
    await expect(
      recoverRoot('rr-does-not-exist', ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF']),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);
  });

  it('two simultaneous recoveries with the same papers: exactly one wins', async () => {
    const organization = await newOrganization('rr-race');
    const codes = [organization.codeAt(GROUP_A_INDEX), organization.codeAt(GROUP_B_INDEX)] as const;

    const outcomes = await Promise.allSettled([
      recoverRoot(organization.slug, codes),
      recoverRoot(organization.slug, codes),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RootRecoveryRejectedError);
    const after = await snapshot(organization.organizationId, organization.rootUserId);
    expect(after.audited).toHaveLength(1);
    expect(after.unusedEmergency).toHaveLength(8);
  });
});
