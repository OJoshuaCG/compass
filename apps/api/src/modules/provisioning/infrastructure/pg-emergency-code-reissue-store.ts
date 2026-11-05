/**
 * Invariantes de seguridad
 * - Se ejecuta con una conexión de OPERACIONES (administrador): `iam_app` no puede hacerlo y nunca se
 *   usa desde una petición HTTP.
 * - La comprobación de «sin códigos vigentes» y la inserción ocurren en la misma transacción y con la
 *   fila de la Raíz bloqueada: dos reemisiones simultáneas no pueden dejar 20 códigos vigentes.
 * - La auditoría solo lleva el conteo; nunca códigos ni hashes.
 */
import type { Pool } from 'pg';

import type {
  ActiveRootIdentity,
  EmergencyCodeReissuePlan,
  EmergencyCodeReissueStore,
} from '../application/reissue-emergency-codes.js';

const ROOT_RANK = 0;

export class PgEmergencyCodeReissueStore implements EmergencyCodeReissueStore {
  constructor(private readonly adminPool: Pool) {}

  async findActiveRoot(organizationSlug: string): Promise<ActiveRootIdentity | null> {
    const result = await this.adminPool.query<{ organization_id: string; user_id: string }>(
      `select o.id as organization_id, u.id as user_id
         from organizations o
         join users u on u.organization_id = o.id and u.rank = $2 and u.status = 'active'
        where o.slug = $1`,
      [organizationSlug, ROOT_RANK],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) return null;
    return { organizationId: row.organization_id, rootUserId: row.user_id };
  }

  async reissue(plan: EmergencyCodeReissuePlan): Promise<boolean> {
    const { root } = plan;
    const client = await this.adminPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [root.organizationId]);

      // La Raíz se vuelve a comprobar dentro de la transacción: entre `findActiveRoot` y aquí pudo cambiar.
      const stillActiveRoot = await client.query(
        `select id from users
          where organization_id = $1 and id = $2 and rank = $3 and status = 'active'
            for update`,
        [root.organizationId, root.rootUserId, ROOT_RANK],
      );
      if (stillActiveRoot.rows.length !== 1) {
        await client.query('rollback');
        return false;
      }

      const liveCodes = await client.query(
        `select 1 from user_recovery_codes
          where organization_id = $1 and kind = 'emergency' and used_at is null
          limit 1`,
        [root.organizationId],
      );
      if (liveCodes.rows.length > 0) {
        await client.query('rollback');
        return false;
      }

      for (const emergencyCode of plan.newEmergencyCodes) {
        await client.query(
          `insert into user_recovery_codes (organization_id, user_id, code_hash, kind, custody_group)
           values ($1, $2, $3, 'emergency', $4)`,
          [
            root.organizationId,
            root.rootUserId,
            Buffer.from(emergencyCode.hash),
            emergencyCode.custodyGroup,
          ],
        );
      }
      await client.query(
        `insert into audit_events (organization_id, action, target_type, target_id, outcome, metadata)
         values ($1, 'auth.emergency_codes_reissued', 'user', $2, 'success', $3::jsonb)`,
        [
          root.organizationId,
          root.rootUserId,
          JSON.stringify({ codesIssued: plan.newEmergencyCodes.length }),
        ],
      );
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
