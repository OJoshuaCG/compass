/**
 * Invariantes de seguridad
 * - Se ejecuta con una conexión de OPERACIONES (administrador): `iam_app` no puede hacerlo y nunca se
 *   usa desde una petición HTTP.
 * - El control dual se comprueba AQUÍ, dentro de la transacción y con las filas bloqueadas: dos
 *   recuperaciones simultáneas con los mismos papeles no pueden ganar las dos.
 * - Todo en una transacción: o la Raíz queda recuperada completa o no cambia nada.
 * - La auditoría solo lleva conteos; nunca códigos, hashes ni contraseñas.
 */
import type { Pool } from 'pg';

import type {
  AdministratorContact,
  RootIdentity,
  RootRecoveryOutcome,
  RootRecoveryPlan,
  RootRecoveryStore,
} from '../application/recover-root.js';

const ROOT_RANK = 0;
const ADMINISTRATOR_RANK = 1;
// Una Raíz suspendida o desactivada se decidió deliberadamente: recuperarla no debe deshacer esa
// decisión, así que el control dual solo actúa sobre una Raíz que pudo entrar (o que nunca entró).
const RECOVERABLE_ROOT_STATUSES = ['invited', 'active'];

export class PgRootRecoveryStore implements RootRecoveryStore {
  constructor(private readonly adminPool: Pool) {}

  async findRoot(organizationSlug: string): Promise<RootIdentity | null> {
    const result = await this.adminPool.query<{
      organization_id: string;
      user_id: string;
      email: string;
      display_name: string;
    }>(
      `select o.id as organization_id, u.id as user_id, u.email, u.display_name
         from organizations o
         join users u on u.organization_id = o.id and u.rank = $2
         join user_roles ur on ur.organization_id = u.organization_id and ur.user_id = u.id
         join roles r on r.organization_id = ur.organization_id and r.id = ur.role_id
        where o.slug = $1 and r.name = 'Root' and u.status = any($3::text[])`,
      [organizationSlug, ROOT_RANK, RECOVERABLE_ROOT_STATUSES],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined) return null;
    return {
      organizationId: row.organization_id,
      rootUserId: row.user_id,
      email: row.email,
      displayName: row.display_name,
    };
  }

  async recover(plan: RootRecoveryPlan): Promise<RootRecoveryOutcome> {
    const { root, recoveredAt } = plan;
    const client = await this.adminPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [root.organizationId]);

      // La Raíz se vuelve a comprobar dentro de la transacción: entre `findRoot` y aquí pudo cambiar.
      const stillRoot = await client.query(
        `select u.id
           from users u
           join user_roles ur on ur.organization_id = u.organization_id and ur.user_id = u.id
           join roles r on r.organization_id = ur.organization_id and r.id = ur.role_id
          where u.organization_id = $1 and u.id = $2 and u.rank = $3 and r.name = 'Root'
            and u.status = any($4::text[])
            for update of u`,
        [root.organizationId, root.rootUserId, ROOT_RANK, RECOVERABLE_ROOT_STATUSES],
      );
      if (stillRoot.rows.length !== 1) return await this.reject(client);

      // Solo cuentan los códigos de EMERGENCIA, de esta Raíz, sin usar. Un código de recuperación
      // ordinario, usado, inexistente o de otra organización simplemente no aparece aquí.
      const presented = await client.query<{ id: string; custody_group: string | null }>(
        `select id, custody_group
           from user_recovery_codes
          where organization_id = $1 and user_id = $2 and kind = 'emergency' and used_at is null
            and code_hash = any($3::bytea[])
            for update`,
        [
          root.organizationId,
          root.rootUserId,
          plan.presentedCodeHashes.map((hash) => Buffer.from(hash)),
        ],
      );
      const groups = new Set(presented.rows.map((row) => row.custody_group));
      const isDualControl =
        presented.rows.length === 2 && groups.size === 2 && groups.has('A') && groups.has('B');
      if (!isDualControl) return await this.reject(client);

      // Los dos códigos usados y todos los demás de emergencia quedan invalidados: la reemisión es total.
      await client.query(
        `update user_recovery_codes set used_at = $3
          where organization_id = $1 and user_id = $2 and used_at is null
            and kind in ('emergency', 'recovery')`,
        [root.organizationId, root.rootUserId, recoveredAt],
      );
      await client.query(
        'update user_totp_factors set revoked_at = $3 where organization_id = $1 and user_id = $2 and revoked_at is null',
        [root.organizationId, root.rootUserId, recoveredAt],
      );
      await client.query(
        'update webauthn_credentials set revoked_at = $3 where organization_id = $1 and user_id = $2 and revoked_at is null',
        [root.organizationId, root.rootUserId, recoveredAt],
      );
      const passwordUpdate = await client.query(
        `update user_passwords set argon2_hash = $3, must_change = true, changed_at = $4
          where organization_id = $1 and user_id = $2`,
        [root.organizationId, root.rootUserId, plan.newPasswordHash, recoveredAt],
      );
      const statusUpdate = await client.query(
        "update users set status = 'invited' where organization_id = $1 and id = $2",
        [root.organizationId, root.rootUserId],
      );
      // Si alguna de las dos no cambió exactamente una fila, se imprimiría una contraseña que no quedó
      // guardada: la excepción deshace todo (el `catch` hace rollback).
      if (passwordUpdate.rowCount !== 1 || statusUpdate.rowCount !== 1) {
        throw new Error('The Root credentials could not be reset consistently.');
      }
      await client.query(
        'update sessions set revoked_at = $3 where organization_id = $1 and user_id = $2 and revoked_at is null',
        [root.organizationId, root.rootUserId, recoveredAt],
      );
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

      const administrators = await client.query<AdministratorContact>(
        `select email, locale from users
          where organization_id = $1 and rank = $2 and status = 'active' order by email`,
        [root.organizationId, ADMINISTRATOR_RANK],
      );
      await client.query(
        `insert into audit_events (organization_id, action, target_type, target_id, outcome, metadata)
         values ($1, 'auth.root_recovered', 'user', $2, 'success', $3::jsonb)`,
        [
          root.organizationId,
          root.rootUserId,
          JSON.stringify({
            codesIssued: plan.newEmergencyCodes.length,
            alertRecipients: administrators.rows.length,
          }),
        ],
      );
      await client.query('commit');
      return { recovered: true, administrators: administrators.rows };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRejection(input: {
    readonly organizationId: string;
    readonly rootUserId: string;
  }): Promise<void> {
    const client = await this.adminPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [input.organizationId]);
      // Sin metadatos a propósito: ni los hashes ni cuántos códigos acertaron se dejan como rastro.
      await client.query(
        `insert into audit_events (organization_id, action, target_type, target_id, outcome, metadata)
         values ($1, 'auth.root_recovery_rejected', 'user', $2, 'denied', '{}'::jsonb)`,
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

  async recordAlertIncomplete(input: {
    readonly organizationId: string;
    readonly recipients: number;
    readonly failed: number;
  }): Promise<void> {
    const client = await this.adminPool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [input.organizationId]);
      await client.query(
        `insert into audit_events (organization_id, action, target_type, outcome, metadata)
         values ($1, 'auth.emergency_alert_incomplete', 'user', 'failure', $2::jsonb)`,
        [
          input.organizationId,
          JSON.stringify({ recipients: input.recipients, failed: input.failed }),
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async reject(client: {
    query: (sql: string) => Promise<unknown>;
  }): Promise<RootRecoveryOutcome> {
    await client.query('rollback');
    return { recovered: false };
  }
}
