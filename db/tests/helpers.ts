import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { bootstrapRoles, migrate } from '../src/index.js';

export const PASSWORDS = { iam_migrator: 'migrator-test-pw', iam_app: 'app-test-pw' } as const;

export interface TestDb {
  name: string;
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
}

function withCredentials(
  adminUrl: string,
  user: string,
  password: string,
  database: string,
): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** Creates an empty database with the grants the migrations expect (no migrations applied). */
export async function createDatabase(clusterAdminUrl: string): Promise<TestDb> {
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const root = new Client({ connectionString: clusterAdminUrl });
  await root.connect();
  try {
    await root.query(`create database ${name}`);
  } finally {
    await root.end();
  }
  const adminUrl = withCredentials(
    clusterAdminUrl,
    new URL(clusterAdminUrl).username,
    new URL(clusterAdminUrl).password,
    name,
  );
  await bootstrapRoles({ connectionString: adminUrl });
  return {
    name,
    adminUrl,
    migratorUrl: withCredentials(clusterAdminUrl, 'iam_migrator', PASSWORDS.iam_migrator, name),
    appUrl: withCredentials(clusterAdminUrl, 'iam_app', PASSWORDS.iam_app, name),
  };
}

/** Database migrated as iam_migrator, the way production does it. */
export async function createMigratedDatabase(clusterAdminUrl: string): Promise<TestDb> {
  const db = await createDatabase(clusterAdminUrl);
  await migrate({ connectionString: db.migratorUrl });
  return db;
}

export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs fn in a transaction with `SET LOCAL app.org_id`, exactly like the UnitOfWork. */
export async function inOrg<T>(client: Client, orgId: string, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Resolves with the SQLSTATE of the failure, or 'none' when the statement succeeds. */
export async function sqlState(
  client: Client,
  sql: string,
  params: unknown[] = [],
  orgId?: string,
): Promise<string> {
  try {
    if (orgId) {
      await inOrg(client, orgId, () => client.query(sql, params));
    } else {
      await client.query(sql, params);
    }
    return 'none';
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

export function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

export async function createOrganization(adminUrl: string, slug: string): Promise<string> {
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<{ id: string }>(
      'insert into organizations (name, slug) values ($1, $1) returning id',
      [slug],
    );
    return rows[0]?.id ?? '';
  } finally {
    await admin.end();
  }
}

export interface Tenant {
  orgId: string;
  tag: string;
  rootId: string;
  adminId: string;
  operatorId: string;
  groupId: string;
  roleId: string;
  platformId: string;
  accountId: string;
  credentialId: string;
  shareId: string;
  sessionToken: string;
  invitationToken: string;
  handoffToken: string;
  rootEmail: string;
}

const FAKE_ARGON = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';

/**
 * Creates one row per phase-1 table for an organization, through iam_app and RLS (the same
 * path the application uses). Deterministic, synthetic data only.
 */
export async function seedTenant(appUrl: string, adminUrl: string, tag: string): Promise<Tenant> {
  const orgId = await createOrganization(adminUrl, `org-${tag}`);
  const app = await connect(appUrl);
  const id = async (sql: string, params: unknown[]): Promise<string> => {
    const { rows } = await app.query<{ id: string }>(sql, params);
    const row = rows[0];
    if (!row) throw new Error(`no row returned for: ${sql}`);
    return row.id;
  };
  try {
    return await inOrg(app, orgId, async () => {
      const rootEmail = `${tag}-root@example.test`;
      const rootId = await id(
        "insert into users (organization_id, email, display_name, rank, status) values ($1, $2, 'Root', 0, 'active') returning id",
        [orgId, rootEmail],
      );
      const adminId = await id(
        "insert into users (organization_id, email, display_name, rank, status, managed_by, created_by) values ($1, $2, 'Admin', 1, 'active', $3, $3) returning id",
        [orgId, `${tag}-admin@example.test`, rootId],
      );
      const operatorId = await id(
        "insert into users (organization_id, email, display_name, rank, status, managed_by, created_by) values ($1, $2, 'Operator', 3, 'active', $3, $3) returning id",
        [orgId, `${tag}-operator@example.test`, adminId],
      );
      await app.query(
        'insert into user_passwords (organization_id, user_id, argon2_hash) values ($1, $2, $3)',
        [orgId, rootId, FAKE_ARGON],
      );
      await app.query(
        "insert into webauthn_credentials (organization_id, user_id, credential_id, public_key, name) values ($1, $2, $3, '\\x01', 'Laptop')",
        [orgId, rootId, sha256(`cred-${tag}`)],
      );
      await app.query(
        "insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at) values ($1, $2, uuid_generate_v7(), 'registration', $3, now() + interval '5 minutes')",
        [orgId, rootId, `challenge-${tag}-0123456789`],
      );
      await app.query(
        "insert into user_totp_factors (organization_id, user_id, secret_ciphertext, nonce, dek_version) values ($1, $2, '\\x00112233445566778899aabbccddeeff', '\\x000000000000000000000000', 1)",
        [orgId, rootId],
      );
      await app.query(
        'insert into user_recovery_codes (organization_id, user_id, code_hash) values ($1, $2, $3)',
        [orgId, rootId, sha256(`rc-${tag}`)],
      );
      const sessionToken = `session-${tag}`;
      await app.query(
        "insert into sessions (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '12 hours')",
        [orgId, rootId, sha256(sessionToken)],
      );
      const invitationToken = `invite-${tag}`;
      await app.query(
        "insert into invitations (organization_id, email, rank, invited_by, managed_by, token_hash, expires_at) values ($1, $2, 2, $3, $3, $4, now() + interval '72 hours')",
        [orgId, `${tag}-invitee@example.test`, rootId, sha256(invitationToken)],
      );
      const groupId = await id(
        "insert into groups (organization_id, name, created_by) values ($1, 'Social', $2) returning id",
        [orgId, adminId],
      );
      await app.query(
        "insert into group_memberships (organization_id, group_id, user_id, role, added_by) values ($1, $2, $3, 'member', $4)",
        [orgId, groupId, operatorId, adminId],
      );
      const roleId = await id(
        "insert into roles (organization_id, name, permissions, created_by) values ($1, 'Custom', '{account.create}', $2) returning id",
        [orgId, rootId],
      );
      await app.query(
        'insert into user_roles (organization_id, user_id, role_id, granted_by) values ($1, $2, $3, $4)',
        [orgId, operatorId, roleId, rootId],
      );
      await app.query(
        "insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref) values ($1, 1, '\\x0102', 'local/test')",
        [orgId],
      );
      const platformId = await id(
        "insert into platforms (organization_id, name, slug, login_url) values ($1, 'Internal', 'internal', 'https://internal.example.test/login') returning id",
        [orgId],
      );
      const accountId = await id(
        "insert into accounts (organization_id, platform_id, display_name, handle, recovery_email_alias, owner_group_id, created_by) values ($1, $2, 'Brand MX', '@brand_mx', $3, $4, $5) returning id",
        [orgId, platformId, `brand-${tag}@id.example.test`, groupId, rootId],
      );
      const credentialId = await id(
        "insert into credentials (organization_id, account_id, label, kind, created_by) values ($1, $2, 'Main', 'password_totp', $3) returning id",
        [orgId, accountId, rootId],
      );
      await app.query(
        "insert into credential_secrets (organization_id, credential_id, field, version, ciphertext, nonce, dek_version, created_by) values ($1, $2, 'password', 1, '\\x00112233445566778899aabbccddeeff00', '\\x000000000000000000000000', 1, $3)",
        [orgId, credentialId, rootId],
      );
      const shareId = await id(
        "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, 'account', $2, 'user', $3, 'VIEW', $4) returning id",
        [orgId, accountId, operatorId, rootId],
      );
      await app.query(
        'insert into password_fingerprints (organization_id, credential_id, hmac) values ($1, $2, $3)',
        [orgId, credentialId, sha256(`fp-${tag}`)],
      );
      await app.query(
        "insert into access_requests (organization_id, requester_id, account_id, level, reason, duration) values ($1, $2, $3, 'EDIT', 'incident', interval '8 hours')",
        [orgId, operatorId, accountId],
      );
      await app.query(
        "insert into rotation_tasks (organization_id, credential_id, trigger, assigned_to, due_at) values ($1, $2, 'manual', $3, now() + interval '7 days')",
        [orgId, credentialId, adminId],
      );
      const handoffToken = `handoff-${tag}`;
      await app.query(
        "insert into totp_handoffs (organization_id, user_id, credential_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '5 minutes')",
        [orgId, rootId, credentialId, sha256(handoffToken)],
      );
      await app.query(
        "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, 'account', 'account.created', '{}')",
        [orgId],
      );
      await app.query(
        "insert into idempotency_keys (organization_id, key, actor_id, request_hash, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')",
        [orgId, `idem-${tag}-0001`, rootId, sha256(`req-${tag}`)],
      );
      await app.query(
        "insert into audit_events (organization_id, actor_id, action, outcome) values ($1, $2, 'account.created', 'success')",
        [orgId, rootId],
      );
      return {
        orgId,
        tag,
        rootId,
        adminId,
        operatorId,
        groupId,
        roleId,
        platformId,
        accountId,
        credentialId,
        shareId,
        sessionToken,
        invitationToken,
        handoffToken,
        rootEmail,
      };
    });
  } finally {
    await app.end();
  }
}
