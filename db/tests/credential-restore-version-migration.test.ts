import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../src/index.js';
import { connect, createDatabase, createOrganization } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const NEW_MIGRATION = '0021_credential_restore_version_permission.sql';
const NEW_PERMISSION = 'credential.restore_version';
const scratch: string[] = [];

afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

interface RoleRow {
  name: string;
  permissions: string[];
  version: number;
}

// SENSIBLE (revisión humana): la migración 0021 modifica permisos de roles ya existentes.
describe('migration 0021: credential.restore_version for existing system roles', () => {
  const adminUrl = inject('adminUrl');

  it('grants the new permission only to live system roles that hold credential.update, and only once', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await mkdtemp(join(tmpdir(), 'iam-migrations-0021-'));
    scratch.push(dir);
    await cp(migrationsDir, dir, { recursive: true });
    await rm(join(dir, NEW_MIGRATION));
    await migrate({ connectionString: db.migratorUrl, directory: dir });

    // Estado "antes": organizaciones con roles creados por la versión anterior del código.
    const orgId = await createOrganization(db.adminUrl, 'before-0021');
    const otherOrgId = await createOrganization(db.adminUrl, 'before-0021-b');
    const admin = await connect(db.adminUrl);
    try {
      const author = (
        await admin.query<{ id: string }>(
          "insert into users (organization_id, email, display_name, rank) values ($1, 'a@x.test', 'Author', 0) returning id",
          [orgId],
        )
      ).rows[0]?.id;
      const insertRole = (
        organizationId: string,
        name: string,
        isSystem: boolean,
        permissions: string[],
        archived: boolean,
      ) =>
        admin.query(
          `insert into roles (organization_id, name, is_system, permissions, created_by, archived_at)
           values ($1, $2, $3, $4::text[], $5, case when $6::boolean then now() else null end)`,
          [organizationId, name, isSystem, permissions, isSystem ? null : author, archived],
        );
      await insertRole(orgId, 'Leader', true, ['credential.update', 'account.create'], false);
      await insertRole(orgId, 'Operator', true, ['account.create'], false);
      await insertRole(orgId, 'Custom editor', false, ['credential.update'], false);
      await insertRole(otherOrgId, 'Leader', true, ['credential.update'], false);
      await insertRole(otherOrgId, 'Retired system', true, ['credential.update'], true);

      const applied = await migrate({ connectionString: db.migratorUrl, directory: migrationsDir });
      expect(applied.applied).toEqual([NEW_MIGRATION]);

      const roles = (
        await admin.query<RoleRow & { organization_id: string }>(
          'select organization_id, name, permissions, version from roles order by organization_id, name',
        )
      ).rows;
      const find = (organizationId: string, name: string) =>
        roles.find((role) => role.organization_id === organizationId && role.name === name);

      // Un rol de sistema vivo con credential.update lo recibe, en cualquier organización.
      expect(find(orgId, 'Leader')?.permissions).toContain(NEW_PERMISSION);
      expect(find(orgId, 'Leader')?.version).toBe(2);
      expect(find(otherOrgId, 'Leader')?.permissions).toContain(NEW_PERMISSION);
      // Sin credential.update no hay nada que conservar: no lo recibe.
      expect(find(orgId, 'Operator')?.permissions).toEqual(['account.create']);
      expect(find(orgId, 'Operator')?.version).toBe(1);
      // Un rol personalizado jamás recibe un permiso sin una concesión explícita de una persona.
      expect(find(orgId, 'Custom editor')?.permissions).toEqual(['credential.update']);
      expect(find(orgId, 'Custom editor')?.version).toBe(1);
      // Un rol archivado no se toca.
      expect(find(otherOrgId, 'Retired system')?.permissions).toEqual(['credential.update']);
      expect(find(otherOrgId, 'Retired system')?.version).toBe(1);

      // La concesión no duplica el permiso ni sube la versión otra vez (idempotente).
      const grantedTwice = roles.filter(
        (role) => role.permissions.filter((permission) => permission === NEW_PERMISSION).length > 1,
      );
      expect(grantedTwice).toEqual([]);

      // El aislamiento forzado por organización quedó restablecido al terminar.
      const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
        "select relforcerowsecurity from pg_class where oid = 'public.roles'::regclass",
      );
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await admin.end();
    }
  });
});
