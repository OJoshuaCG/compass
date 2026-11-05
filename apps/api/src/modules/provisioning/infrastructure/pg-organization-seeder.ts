/**
 * Invariantes de seguridad
 * - Modo `direct` (script de operaciones): se ejecuta con una conexión de OPERACIONES, porque
 *   `iam_app` no puede insertar en `organizations`. Nunca se usa desde una petición HTTP.
 * - Modo `first-setup` (enlace único, ADR 0046): se ejecuta con el pool de la aplicación y la
 *   organización nace por `auth.create_first_organization`, que la base de datos rechaza si ya
 *   existe cualquier organización. El resto de las filas entran bajo las políticas normales.
 * - Todo en una transacción: o nace la organización completa o no nace nada.
 */
import type { Pool, PoolClient } from 'pg';

import type { OrganizationSeeder } from '../application/bootstrap-organization.js';

/** Cómo nace la fila de `organizations`; el resto del alta es idéntico en ambos modos. */
export type OrganizationCreationMode = 'direct' | 'first-setup';

export class PgOrganizationSeeder implements OrganizationSeeder {
  constructor(
    private readonly pool: Pool,
    private readonly creationMode: OrganizationCreationMode = 'direct',
  ) {}

  async seed(input: Parameters<OrganizationSeeder['seed']>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [input.organizationId]);
      await this.createOrganization(client, input);
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
         values ($1, $2, $3, $4)`,
        [
          input.organizationId,
          input.rootUserId,
          input.rootPasswordHash,
          input.rootPasswordMustChange ?? true,
        ],
      );
      await client.query(
        `insert into user_roles (organization_id, user_id, role_id, granted_by)
         values ($1, $2, $3, $2)`,
        [input.organizationId, input.rootUserId, rootRoleId],
      );
      for (const emergencyCode of input.emergencyCodes) {
        await client.query(
          `insert into user_recovery_codes (organization_id, user_id, code_hash, kind, custody_group)
           values ($1, $2, $3, 'emergency', $4)`,
          [
            input.organizationId,
            input.rootUserId,
            Buffer.from(emergencyCode.hash),
            emergencyCode.custodyGroup,
          ],
        );
      }
      // El alta queda en la cadena de auditoría de la organización (sin actor: la hace operaciones
      // o el enlace único de configuración inicial).
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

  private async createOrganization(
    client: PoolClient,
    input: Parameters<OrganizationSeeder['seed']>[0],
  ): Promise<void> {
    if (this.creationMode === 'first-setup') {
      // La función rechaza con SQLSTATE IAM01 si ya existe cualquier organización.
      await client.query('select auth.create_first_organization($1, $2, $3)', [
        input.organizationId,
        input.name,
        input.slug,
      ]);
      return;
    }
    await client.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [
      input.organizationId,
      input.name,
      input.slug,
    ]);
  }
}
