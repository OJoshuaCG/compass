/**
 * Invariantes de seguridad
 * - Se ejecuta con una conexión de OPERACIONES (administrador): `iam_app` no puede crear
 *   organizaciones. Nunca se usa desde una petición HTTP.
 * - Todo en una transacción: o nace la organización completa o no nace nada.
 */
import type { Pool } from 'pg';

import type { OrganizationSeeder } from '../application/bootstrap-organization.js';

export class PgOrganizationSeeder implements OrganizationSeeder {
  constructor(private readonly adminPool: Pool) {}

  async seed(input: Parameters<OrganizationSeeder['seed']>[0]): Promise<void> {
    const client = await this.adminPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [input.organizationId]);
      await client.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [
        input.organizationId,
        input.name,
        input.slug,
      ]);
      let rootRoleId = '';
      for (const role of input.roles) {
        const inserted = await client.query<{ id: string }>(
          `insert into roles (organization_id, name, is_system, permissions)
           values ($1, $2, true, $3::text[]) returning id`,
          [input.organizationId, role.name, role.permissions],
        );
        if (role.name === 'Root') rootRoleId = inserted.rows[0]?.id ?? '';
      }
      await client.query(
        `insert into users (id, organization_id, email, display_name, rank, status)
         values ($1, $2, $3, $4, 0, 'invited')`,
        [input.rootUserId, input.organizationId, input.rootEmail, input.rootDisplayName],
      );
      await client.query(
        `insert into user_passwords (organization_id, user_id, argon2_hash, must_change)
         values ($1, $2, $3, true)`,
        [input.organizationId, input.rootUserId, input.rootPasswordHash],
      );
      await client.query(
        `insert into user_roles (organization_id, user_id, role_id, granted_by)
         values ($1, $2, $3, $2)`,
        [input.organizationId, input.rootUserId, rootRoleId],
      );
      // El alta queda en la cadena de auditoría de la organización (sin actor: la hace operaciones).
      await client.query(
        `insert into audit_events (organization_id, action, target_type, target_id, outcome, metadata)
         values ($1, 'organization.provisioned', 'user', $2, 'success', '{}'::jsonb)`,
        [input.organizationId, input.rootUserId],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
