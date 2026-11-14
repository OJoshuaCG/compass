/**
 * Invariantes de seguridad
 * - El descubrimiento usa solo `auth.list_sources_with_pending_mail_deletes()` (SECURITY DEFINER, solo ids):
 *   el rol del worker no lee `mail_delete_requests` sin organización fijada.
 * - Leer y cerrar corren en una transacción corta con la organización de la fuente fijada; nunca queda una
 *   transacción abierta durante la red.
 * - Solo escribe `status`, `result_code` y `completed_at` (los únicos permisos de columna del worker) y solo
 *   sobre una fila todavía pendiente.
 */
import type { Pool } from 'pg';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { IdGenerator } from '../../../shared/kernel/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type {
  MailDeleteResultCode,
  MailDeleteWorkStore,
  PendingMailDelete,
} from '../application/ports/mail-delete-work-store.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';

interface SourceRow {
  organization_id: string;
  source_id: string;
}

interface PendingRow {
  id: string;
  mailbox_uid_validity: string;
  mailbox_uid: string;
}

export class PgMailDeleteWorkStore implements MailDeleteWorkStore {
  constructor(
    private readonly pool: Pool,
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly ids: IdGenerator,
  ) {}

  async listSourcesWithPending(): Promise<readonly SourceRef[]> {
    const result = await this.pool.query<SourceRow>(
      'select organization_id, source_id from auth.list_sources_with_pending_mail_deletes()',
    );
    return result.rows.map((row) => ({
      organizationId: asOrganizationId(row.organization_id),
      sourceId: row.source_id,
    }));
  }

  listPending(source: SourceRef, limit: number): Promise<readonly PendingMailDelete[]> {
    return this.inSource(source, async () => {
      const result = await this.transactions.current().query<PendingRow>(
        `select id, mailbox_uid_validity, mailbox_uid
           from mail_delete_requests
          where organization_id = $1
            and source_id = $2
            and status = 'pending'
          order by id
          limit $3`,
        [source.organizationId, source.sourceId, limit],
      );
      // `id` es UUID v7: ordenar por él equivale a ordenar por antigüedad sin leer `requested_at`.
      return result.rows.map((row) => ({
        requestId: row.id,
        mailboxUidValidity: Number(row.mailbox_uid_validity),
        mailboxUid: Number(row.mailbox_uid),
      }));
    });
  }

  close(
    source: SourceRef,
    requestId: string,
    resultCode: MailDeleteResultCode,
    now: Date,
  ): Promise<void> {
    return this.inSource(source, async () => {
      await this.transactions.current().query(
        `update mail_delete_requests
            set status = $3, result_code = $4, completed_at = $5
          where organization_id = $1
            and id = $2
            and status = 'pending'`,
        [
          source.organizationId,
          requestId,
          resultCode === 'DELETED' ? 'done' : 'failed',
          resultCode,
          now,
        ],
      );
    });
  }

  private inSource<T>(source: SourceRef, fn: () => Promise<T>): Promise<T> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      fn,
    );
  }
}
