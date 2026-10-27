/**
 * Invariantes de seguridad
 * - Solo se persiste la DEK envuelta por el KMS (`wrapped_dek`); el texto en claro nunca llega aquí.
 * - Corre en la transacción en curso con `app.org_id` fijado: RLS impide tocar claves de otra organización.
 * - Rotar es atómico: el índice único parcial garantiza una sola DEK activa por organización.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import type { TransactionProvider } from '../../organization/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type {
  DataKeyRecord,
  DataKeyRepository,
  DataKeyStatus,
} from '../application/ports/data-key-repository.js';
import { dataKeys } from './schema.js';

export class PgDataKeyRepository implements DataKeyRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async findActive(organizationId: OrganizationId): Promise<DataKeyRecord | null> {
    const db = drizzle({ client: this.transactions.current() });
    const [row] = await db
      .select()
      .from(dataKeys)
      .where(and(eq(dataKeys.organizationId, organizationId), eq(dataKeys.status, 'active')));
    return row === undefined ? null : toRecord(row);
  }

  async findByVersion(
    organizationId: OrganizationId,
    version: number,
  ): Promise<DataKeyRecord | null> {
    const db = drizzle({ client: this.transactions.current() });
    const [row] = await db
      .select()
      .from(dataKeys)
      .where(and(eq(dataKeys.organizationId, organizationId), eq(dataKeys.version, version)));
    return row === undefined ? null : toRecord(row);
  }

  async insertAsActive(record: Omit<DataKeyRecord, 'status'>): Promise<'inserted' | 'conflict'> {
    const db = drizzle({ client: this.transactions.current() });
    // 1) Se reserva la versión como `retired` (sin chocar con el índice de "una sola activa").
    //    Si otra instancia ya creó esa versión, `do nothing` lo señala sin abortar la transacción.
    const inserted = await db
      .insert(dataKeys)
      .values({
        organizationId: record.organizationId,
        version: record.version,
        wrappedDek: record.wrapped,
        kmsKeyRef: record.kmsKeyRef,
        status: 'retired',
      })
      .onConflictDoNothing({ target: [dataKeys.organizationId, dataKeys.version] })
      .returning({ id: dataKeys.id });
    if (inserted.length === 0) return 'conflict';
    // 2) Se retira la activa anterior y 3) se activa la nueva, dentro de la misma transacción.
    await db
      .update(dataKeys)
      .set({ status: 'retired' })
      .where(
        and(eq(dataKeys.organizationId, record.organizationId), eq(dataKeys.status, 'active')),
      );
    await db
      .update(dataKeys)
      .set({ status: 'active' })
      .where(
        and(
          eq(dataKeys.organizationId, record.organizationId),
          eq(dataKeys.version, record.version),
        ),
      );
    return 'inserted';
  }
}

function toRecord(row: typeof dataKeys.$inferSelect): DataKeyRecord {
  return {
    organizationId: row.organizationId as OrganizationId,
    version: row.version,
    wrapped: row.wrappedDek,
    kmsKeyRef: row.kmsKeyRef,
    status: row.status as DataKeyStatus,
  };
}
