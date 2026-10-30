import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../src/index.js';
import { connect, createDatabase, createOrganization } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const NEW_MIGRATION = '0023_inbound_permissions.sql';
const READ_CODES = 'inbound.read_codes';
const CONFIGURE = 'inbound.configure';
const REVEAL_RESET = 'inbound.reveal_reset';
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

// SENSIBLE (revisión humana): la migración 0023 modifica permisos de roles ya existentes.
describe('migration 0023: inbound permissions for existing system roles', () => {
  const adminUrl = inject('adminUrl');

  it('grants each permission only to the live system roles of its ceiling, once, and never to custom or archived roles', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await mkdtemp(join(tmpdir(), 'iam-migrations-0023-'));
    scratch.push(dir);
    await cp(migrationsDir, dir, { recursive: true });
    // El migrador rechaza aplicar una migración anterior a la última ya aplicada: para reproducir el
    // estado "antes de 0023" hay que quitar 0023 y TODAS las posteriores, y dejarlas para la segunda pasada.
    const laterMigrations = (await readdir(dir)).filter((file) => file >= NEW_MIGRATION);
    await Promise.all(laterMigrations.map((file) => rm(join(dir, file))));
    await migrate({ connectionString: db.migratorUrl, directory: dir });

    // Estado "antes": roles creados por la versión anterior del código, con permisos ancla de cada techo.
    const orgId = await createOrganization(db.adminUrl, 'before-0023');
    const otherOrgId = await createOrganization(db.adminUrl, 'before-0023-b');
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
      const rootLike = ['platform.manage', 'account.archive', 'credential.use_totp'];
      const leaderLike = ['account.archive', 'credential.use_totp'];
      const operatorLike = ['credential.use_totp'];
      await insertRole(orgId, 'Administrator', true, rootLike, false);
      await insertRole(orgId, 'Leader', true, leaderLike, false);
      await insertRole(orgId, 'Operator', true, operatorLike, false);
      await insertRole(orgId, 'Custom with everything', false, rootLike, false);
      await insertRole(otherOrgId, 'Leader', true, leaderLike, false);
      await insertRole(otherOrgId, 'Retired system', true, rootLike, true);

      const applied = await migrate({ connectionString: db.migratorUrl, directory: migrationsDir });
      expect(applied.applied).toEqual([...laterMigrations].sort());

      const roles = (
        await admin.query<RoleRow>(
          'select organization_id, name, permissions, version from roles order by organization_id, name',
        )
      ).rows;
      const find = (organizationId: string, name: string) =>
        roles.find((role) => role.organization_id === organizationId && role.name === name);

      // Administrador: los tres. Líder: lectura y configuración, nunca restablecimientos. Operador: solo lectura.
      expect(find(orgId, 'Administrator')?.permissions).toEqual(
        expect.arrayContaining([READ_CODES, CONFIGURE, REVEAL_RESET]),
      );
      expect(find(orgId, 'Administrator')?.version).toBe(4);
      expect(find(orgId, 'Leader')?.permissions).toEqual(
        expect.arrayContaining([READ_CODES, CONFIGURE]),
      );
      expect(find(orgId, 'Leader')?.permissions).not.toContain(REVEAL_RESET);
      expect(find(orgId, 'Leader')?.version).toBe(3);
      expect(find(otherOrgId, 'Leader')?.permissions).toContain(CONFIGURE);
      expect(find(orgId, 'Operator')?.permissions).toContain(READ_CODES);
      expect(find(orgId, 'Operator')?.permissions).not.toContain(CONFIGURE);
      expect(find(orgId, 'Operator')?.permissions).not.toContain(REVEAL_RESET);
      expect(find(orgId, 'Operator')?.version).toBe(2);

      // Un rol personalizado jamás recibe un permiso sin una concesión explícita de una persona.
      expect(find(orgId, 'Custom with everything')?.permissions).toEqual(rootLike);
      expect(find(orgId, 'Custom with everything')?.version).toBe(1);
      // Un rol archivado no se toca.
      expect(find(otherOrgId, 'Retired system')?.permissions).toEqual(rootLike);
      expect(find(otherOrgId, 'Retired system')?.version).toBe(1);

      // La concesión no duplica ningún permiso.
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
