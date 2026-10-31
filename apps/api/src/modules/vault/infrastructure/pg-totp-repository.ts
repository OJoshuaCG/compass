/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita el estado del segundo factor a la organización.
 * - Aquí no hay secretos: solo estado y parámetros públicos. El URI vive cifrado en `credential_secrets`.
 * - Las consultas llevan parámetros enlazados; ningún valor se compone en el SQL.
 */
import type { TotpAlgorithm, TotpStatus } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewTotp,
  NewTotpExportRotationTask,
  TotpRecord,
  TotpRepository,
} from '../application/ports/totp-repository.js';
import type { TotpDigits, TotpPeriodSeconds } from '../domain/otpauth-uri.js';

interface TotpRow {
  credential_id: string;
  secret_version: number;
  status: TotpStatus;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  period_seconds: TotpPeriodSeconds;
  registered_by: string;
  registered_at: Date;
  verified_at: Date | null;
  retired_at: Date | null;
  exposed_at: Date | null;
}

const TOTP_COLUMNS = `credential_id, secret_version, status, algorithm, digits, period_seconds,
       registered_by, registered_at, verified_at, retired_at, exposed_at`;

/** Disparador de la tarea de rotación que crea una exportación del segundo factor (migración 0006). */
const ROTATION_TRIGGER_TOTP_EXPORTED = 'totp_exported';
const ROTATION_PRIORITY_HIGH = 'high';

const toRecord = (row: TotpRow): TotpRecord => ({
  credentialId: row.credential_id,
  secretVersion: row.secret_version,
  status: row.status,
  algorithm: row.algorithm,
  digits: row.digits,
  periodSeconds: row.period_seconds,
  registeredBy: row.registered_by,
  registeredAt: row.registered_at,
  verifiedAt: row.verified_at,
  retiredAt: row.retired_at,
  exposedAt: row.exposed_at,
});

export class PgTotpRepository implements TotpRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async find(credentialId: string): Promise<TotpRecord | null> {
    const result = await this.transactions
      .current()
      .query<TotpRow>(`select ${TOTP_COLUMNS} from credential_totp where credential_id = $1`, [
        credentialId,
      ]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async insert(totp: NewTotp): Promise<void> {
    await this.transactions.current().query(
      `insert into credential_totp
         (organization_id, credential_id, secret_version, status, algorithm, digits, period_seconds,
          registered_by, registered_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, 'pending', $3, $4, $5, $6, $7)`,
      [
        totp.credentialId,
        totp.secretVersion,
        totp.algorithm,
        totp.digits,
        totp.periodSeconds,
        totp.registeredBy,
        totp.registeredAt,
      ],
    );
  }

  async replace(totp: NewTotp, keepExposure: boolean): Promise<void> {
    await this.transactions.current().query(
      `update credential_totp
          set secret_version = $2, status = 'pending', algorithm = $3, digits = $4, period_seconds = $5,
              registered_by = $6, registered_at = $7,
              verified_at = null, retired_at = null,
              exposed_at = case when $8::boolean then exposed_at else null end,
              pending_notice_at = null
        where credential_id = $1`,
      [
        totp.credentialId,
        totp.secretVersion,
        totp.algorithm,
        totp.digits,
        totp.periodSeconds,
        totp.registeredBy,
        totp.registeredAt,
        keepExposure,
      ],
    );
    // La salud debe coincidir con `exposed_at` y con el estado: un factor re-registrado ya no está retirado,
    // y un secreto nuevo nunca se exportó.
    await this.transactions.current().query(
      `update credentials
          set health = case when $2::boolean then health else health - 'totpExposedAt' end - 'totpRetiredAt'
        where id = $1`,
      [totp.credentialId, keepExposure],
    );
  }

  async markVerified(credentialId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        "update credential_totp set status = 'verified', verified_at = $2 where credential_id = $1",
        [credentialId, at],
      );
  }

  async markRetired(credentialId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        "update credential_totp set status = 'retired', retired_at = $2 where credential_id = $1",
        [credentialId, at],
      );
    // El inventario y la salud deben mostrar que el segundo factor se apagó (plan.md, retirar el 2FA).
    await this.transactions.current().query(
      `update credentials
          set health = health || jsonb_build_object('totpRetiredAt', $2::timestamptz)
        where id = $1`,
      [credentialId, at],
    );
  }

  async markExposed(credentialId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update credential_totp set exposed_at = $2 where credential_id = $1', [
        credentialId,
        at,
      ]);
    await this.transactions.current().query(
      `update credentials
          set health = health || jsonb_build_object('totpExposedAt', $2::timestamptz)
        where id = $1`,
      [credentialId, at],
    );
  }

  async markCredentialWithTotp(credentialId: string): Promise<void> {
    await this.transactions
      .current()
      .query("update credentials set kind = 'password_totp' where id = $1 and kind = 'password'", [
        credentialId,
      ]);
  }

  async lockCodesOf(userId: UserId, credentialId: string): Promise<void> {
    await this.transactions
      .current()
      .query(
        "select pg_advisory_xact_lock(hashtextextended('totp-code:' || current_setting('app.org_id', true) || ':' || $1::text || ':' || $2::text, 0))",
        [userId, credentialId],
      );
  }

  async openExportRotationTaskExists(credentialId: string): Promise<boolean> {
    const result = await this.transactions.current().query(
      `select 1
         from rotation_tasks
        where credential_id = $1
          and trigger = $2
          and status in ('pending', 'in_progress')`,
      [credentialId, ROTATION_TRIGGER_TOTP_EXPORTED],
    );
    return result.rows.length > 0;
  }

  async insertExportRotationTask(task: NewTotpExportRotationTask): Promise<void> {
    await this.transactions.current().query(
      `insert into rotation_tasks
         (organization_id, credential_id, trigger, triggered_by_user, assigned_to, priority, due_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
      [
        task.credentialId,
        ROTATION_TRIGGER_TOTP_EXPORTED,
        task.triggeredByUser,
        task.assignedTo,
        ROTATION_PRIORITY_HIGH,
        task.dueAt,
      ],
    );
  }
}
