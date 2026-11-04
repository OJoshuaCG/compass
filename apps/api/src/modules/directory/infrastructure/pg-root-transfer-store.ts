/**
 * Almacén de la transferencia de la Raíz sobre PostgreSQL.
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización, que sale de `app.org_id`,
 *   nunca de un parámetro.
 * - La base garantiza una sola transferencia abierta por organización (índice único parcial) y fechas
 *   coherentes con el estado; este adaptador no las duplica.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import { asUserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewRootTransfer,
  RootTransferClosing,
  RootTransferStore,
} from '../application/ports/root-transfer-store.js';
import type { RootTransferRecord, RootTransferStatus } from '../domain/root-transfer.js';

interface RootTransferRow {
  readonly id: string;
  readonly from_user_id: string;
  readonly to_user_id: string;
  readonly status: RootTransferStatus;
  readonly requested_at: Date;
  readonly expires_at: Date;
  readonly accepted_at: Date | null;
  readonly executes_at: Date | null;
}

const SELECTED_COLUMNS = `id, from_user_id, to_user_id, status, requested_at, expires_at, accepted_at, executes_at`;

const toRecord = (row: RootTransferRow): RootTransferRecord => ({
  id: row.id,
  fromUserId: asUserId(row.from_user_id),
  toUserId: asUserId(row.to_user_id),
  status: row.status,
  requestedAt: row.requested_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  executesAt: row.executes_at,
});

export class PgRootTransferStore implements RootTransferStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async findOpenForUpdate(): Promise<RootTransferRecord | null> {
    const result = await this.transactions.current().query<RootTransferRow>(
      `select ${SELECTED_COLUMNS}
         from root_transfers
        where status in ('pending_acceptance', 'waiting')
        for update`,
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async insert(transfer: NewRootTransfer): Promise<RootTransferRecord> {
    const result = await this.transactions.current().query<RootTransferRow>(
      `insert into root_transfers (organization_id, from_user_id, to_user_id, requested_at, expires_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4)
       returning ${SELECTED_COLUMNS}`,
      [transfer.fromUserId, transfer.toUserId, transfer.requestedAt, transfer.expiresAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('The root transfer insert returned no row');
    return toRecord(row);
  }

  async markAccepted(id: string, acceptedAt: Date, executesAt: Date): Promise<void> {
    await this.transactions.current().query(
      `update root_transfers
          set status = 'waiting', accepted_at = $2, executes_at = $3, updated_at = $2
        where id = $1 and status = 'pending_acceptance'`,
      [id, acceptedAt, executesAt],
    );
  }

  async close(id: string, closing: RootTransferClosing): Promise<void> {
    const cancelledBy: UserId | null = closing.cancelledBy;
    await this.transactions.current().query(
      `update root_transfers
          set status = $2, closed_at = $3, cancelled_by = $4, cancel_reason = $5, updated_at = $3
        where id = $1 and status in ('pending_acceptance', 'waiting')`,
      [id, closing.status, closing.closedAt, cancelledBy, closing.cancelReason],
    );
  }
}
