import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../src/index.js';
import { connect, createDatabase, createOrganization } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const NEW_MIGRATION = '0026_invitation_link_permission.sql';
const INVITE_LINK = 'user.invite_link';
const scratch: string[] = [];

afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

interface RoleRow {
  organization_id: string;
  name: string;
  permissions: string[];
  version: number;
}

// SENSIBLE (revisión humana): la migración 0026 modifica permisos de roles ya existentes.
describe('migration 0026: user.invite_link for existing system roles', () => {
  const adminUrl = inject('adminUrl');

  it('grants the permission only to live system roles that hold user.invite, once, and never to custom or archived roles', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await mkdtemp(join(tmpdir(), 'iam-migrations-0026-'));
    scratch.push(dir);
    await cp(migrationsDir, dir, { recursive: true });
    // El migrador rechaza aplicar una migración anterior a la última ya aplicada: para reproducir el
    // estado "antes de 0026" hay que quitar 0026 y TODAS las posteriores, y dejarlas para la segunda pasada.
    const laterMigrations = (await readdir(dir)).filter((file) => file >= NEW_MIGRATION);
    await Promise.all(laterMigrations.map((file) => rm(join(dir, file))));
    await migrate({ connectionString: db.migratorUrl, directory: dir });

    const orgId = await createOrganization(db.adminUrl, 'before-0026');
    const otherOrgId = await createOrganization(db.adminUrl, 'before-0026-b');
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
      const inviters = ['user.invite', 'account.archive'];
      const operatorLike = ['credential.use_totp'];
      await insertRole(orgId, 'Administrator', true, inviters, false);
      await insertRole(orgId, 'Leader', true, inviters, false);
      await insertRole(orgId, 'Operator', true, operatorLike, false);
      await insertRole(orgId, 'Custom inviter', false, inviters, false);
      await insertRole(otherOrgId, 'Leader', true, inviters, false);
      await insertRole(otherOrgId, 'Retired system', true, inviters, true);

      const applied = await migrate({ connectionString: db.migratorUrl, directory: migrationsDir });
      expect(applied.applied).toEqual([...laterMigrations].sort());

      const roles = (
        await admin.query<RoleRow>(
          'select organization_id, name, permissions, version from roles order by organization_id, name',
        )
      ).rows;
      const find = (organizationId: string, name: string) =>
        roles.find((role) => role.organization_id === organizationId && role.name === name);

      // Quien ya podía invitar (rol de sistema vivo) recibe el permiso; el Operador, que no invita, no.
      expect(find(orgId, 'Administrator')?.permissions).toContain(INVITE_LINK);
      expect(find(orgId, 'Administrator')?.version).toBe(2);
      expect(find(orgId, 'Leader')?.permissions).toContain(INVITE_LINK);
      expect(find(otherOrgId, 'Leader')?.permissions).toContain(INVITE_LINK);
      expect(find(orgId, 'Operator')?.permissions).not.toContain(INVITE_LINK);
      expect(find(orgId, 'Operator')?.version).toBe(1);

      // Un rol personalizado jamás recibe un permiso sin una concesión explícita de una persona.
      expect(find(orgId, 'Custom inviter')?.permissions).toEqual(inviters);
      expect(find(orgId, 'Custom inviter')?.version).toBe(1);
      // Un rol archivado no se toca.
      expect(find(otherOrgId, 'Retired system')?.permissions).toEqual(inviters);
      expect(find(otherOrgId, 'Retired system')?.version).toBe(1);

      const duplicated = roles.filter(
        (role) => new Set(role.permissions).size !== role.permissions.length,
      );
      expect(duplicated).toEqual([]);

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
