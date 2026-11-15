import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../src/index.js';
import { connect, createDatabase, seedTenant, sqlState } from './helpers.js';

// Las migraciones 0041, 0042 y 0043 se aplican sobre una base que ya tiene filas de la versión anterior:
// ninguna fila previa se pierde ni se inventa, y la concesión del permiso nuevo es acotada e idempotente.
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const FIRST_MIGRATION_UNDER_TEST = '0041_mail_preview_requests_per_person.sql';
const NEW_PERMISSION = 'credential.view_health';
const UNIQUE_VIOLATION = '23505';
const NO_FAILURE = 'none';
const UID_VALIDITY = 7;
const MAILBOX_UID = 11;
const scratch: string[] = [];

afterAll(async () => {
  await Promise.all(scratch.map((directory) => rm(directory, { recursive: true, force: true })));
});

interface RoleRow {
  organization_id: string;
  name: string;
  permissions: string[];
  version: number;
}

// SENSIBLE (revisión humana): la 0043 modifica permisos de roles ya existentes.
describe('migraciones 0041-0043 sobre una base con datos previos', () => {
  const clusterAdminUrl = inject('adminUrl');

  it('conservan las filas anteriores y conceden el permiso solo a roles de sistema vivos con group.manage_members', async () => {
    const db = await createDatabase(clusterAdminUrl);
    const directory = await mkdtemp(join(tmpdir(), 'iam-migrations-0041-'));
    scratch.push(directory);
    await cp(migrationsDir, directory, { recursive: true });
    // El migrador rechaza aplicar una migración anterior a la última ya aplicada: se quitan la 0041 y las
    // posteriores para reproducir el estado «antes» y se aplican en la segunda pasada.
    const migrationsUnderTest = (await readdir(directory)).filter(
      (file) => file >= FIRST_MIGRATION_UNDER_TEST,
    );
    await Promise.all(migrationsUnderTest.map((file) => rm(join(directory, file))));
    await migrate({ connectionString: db.migratorUrl, directory });

    const tenant = await seedTenant(db.appUrl, db.adminUrl, 'before-health');
    const admin = await connect(db.adminUrl);
    try {
      const fingerprintBefore = (
        await admin.query<{ hmac: string }>(
          "select encode(hmac, 'hex') as hmac from password_fingerprints where credential_id = $1",
          [tenant.credentialId],
        )
      ).rows[0]?.hmac;
      expect(fingerprintBefore).toBeDefined();

      const sourceId = (
        await admin.query<{ id: string }>(
          `insert into mail_sources (organization_id, channel, address, display_name, created_by)
           values ($1, 'mail', 'before-health@example.test', 'Buzón', $2) returning id`,
          [tenant.orgId, tenant.rootId],
        )
      ).rows[0]?.id;
      const receiptId = (await admin.query<{ id: string }>('select uuid_generate_v7() as id'))
        .rows[0]?.id;
      const insertPreview = (requestedBy: string, kind: string): Promise<string> =>
        sqlState(
          admin,
          `insert into mail_preview_requests
             (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind, requested_by, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes')`,
          [tenant.orgId, sourceId, receiptId, UID_VALIDITY, MAILBOX_UID, kind, requestedBy],
        );
      // Con el índice anterior hay una sola petición viva por recibo y clase.
      expect(await insertPreview(tenant.rootId, 'subject')).toBe(NO_FAILURE);
      expect(await insertPreview(tenant.adminId, 'subject')).toBe(UNIQUE_VIOLATION);

      const insertRole = (
        name: string,
        isSystem: boolean,
        permissions: string[],
        archived: boolean,
      ) =>
        admin.query(
          `insert into roles (organization_id, name, is_system, permissions, created_by, archived_at)
           values ($1, $2, $3, $4::text[], $5, case when $6::boolean then now() else null end)`,
          [tenant.orgId, name, isSystem, permissions, isSystem ? null : tenant.rootId, archived],
        );
      await insertRole(
        'Sistema con gestión',
        true,
        ['group.manage_members', 'account.create'],
        false,
      );
      await insertRole('Sistema sin gestión', true, ['account.create'], false);
      await insertRole('Personalizado con gestión', false, ['group.manage_members'], false);
      await insertRole('Sistema archivado', true, ['group.manage_members'], true);

      const applied = await migrate({ connectionString: db.migratorUrl, directory: migrationsDir });
      expect(applied.applied).toEqual([...migrationsUnderTest].sort());

      // 0042: la huella anterior sigue intacta y sin puntaje inventado.
      const fingerprintRow = (
        await admin.query<{ hmac: string; strength_score: number | null }>(
          `select encode(hmac, 'hex') as hmac, strength_score from password_fingerprints where credential_id = $1`,
          [tenant.credentialId],
        )
      ).rows[0];
      expect(fingerprintRow?.hmac).toBe(fingerprintBefore);
      expect(fingerprintRow?.strength_score).toBeNull();

      // 0041: la petición anterior sobrevive y ahora cada persona tiene la suya; la misma persona no duplica.
      const previewCount = (
        await admin.query<{ total: string }>(
          'select count(*) as total from mail_preview_requests where receipt_id = $1',
          [receiptId],
        )
      ).rows[0]?.total;
      expect(previewCount).toBe('1');
      expect(await insertPreview(tenant.adminId, 'subject')).toBe(NO_FAILURE);
      expect(await insertPreview(tenant.rootId, 'subject')).toBe(UNIQUE_VIOLATION);

      // 0043: solo un rol de sistema vivo con group.manage_members recibe el permiso, una vez.
      const roles = (
        await admin.query<RoleRow>(
          'select organization_id, name, permissions, version from roles where organization_id = $1',
          [tenant.orgId],
        )
      ).rows;
      const find = (name: string) => roles.find((role) => role.name === name);
      expect(find('Sistema con gestión')?.permissions).toContain(NEW_PERMISSION);
      expect(find('Sistema con gestión')?.version).toBe(2);
      expect(find('Sistema sin gestión')?.permissions).toEqual(['account.create']);
      expect(find('Sistema sin gestión')?.version).toBe(1);
      expect(find('Personalizado con gestión')?.permissions).toEqual(['group.manage_members']);
      expect(find('Personalizado con gestión')?.version).toBe(1);
      expect(find('Sistema archivado')?.permissions).toEqual(['group.manage_members']);
      expect(find('Sistema archivado')?.version).toBe(1);
      const duplicated = roles.filter(
        (role) => role.permissions.filter((permission) => permission === NEW_PERMISSION).length > 1,
      );
      expect(duplicated).toEqual([]);

      // El aislamiento forzado por organización quedó restablecido.
      const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
        "select relforcerowsecurity from pg_class where oid = 'public.roles'::regclass",
      );
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await admin.end();
    }
  });
});
