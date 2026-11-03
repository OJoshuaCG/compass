/**
 * Invariantes de seguridad
 * - El worker del sondeo nunca crea ni rota una DEK (ADR 0045, paso 4): solo lee el material envuelto.
 * - `findActive` falla si la organización no tiene llave activa (ver abajo) e `insertAsActive` falla siempre. Sin este tope, `DataKeyResolver` crearía la versión 1 de una
 *   organización que aún no tiene llave en cuanto el worker intentara cifrar un elemento.
 * - Pide solo las columnas sobre las que el rol del worker tiene `select` (migración 0029). No puede
 *   reutilizar `PgDataKeyRepository`: su `select()` pide todas las columnas y el rol del worker lo rechaza.
 */
import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { DataKeyRecord, DataKeyRepository } from '../../crypto/index.js';
import type { TransactionProvider } from '../../organization/index.js';

interface DataKeyRow {
  organization_id: string;
  version: number;
  wrapped_dek: Buffer;
  kms_key_ref: string;
  status: DataKeyRecord['status'];
}

const NO_ACTIVE_KEY_MESSAGE =
  'The organization has no active data key and the inbound worker cannot create one';
const READABLE_COLUMNS = 'organization_id, version, wrapped_dek, kms_key_ref, status';

export class ReadOnlyDataKeyRepository implements DataKeyRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async findActive(organizationId: OrganizationId): Promise<DataKeyRecord | null> {
    const result = await this.transactions
      .current()
      .query<DataKeyRow>(
        `select ${READABLE_COLUMNS} from data_keys where organization_id = $1 and status = 'active'`,
        [organizationId],
      );
    const active = toRecord(result.rows[0]);
    // Sin llave activa el resolver generaría una DEK en el KMS (efecto real, con costo y auditoría) antes
    // de que `insertAsActive` la rechazara. Se corta aquí, antes de llegar al KMS.
    if (active === null) throw new DomainError('CRYPTO.KMS_UNAVAILABLE', NO_ACTIVE_KEY_MESSAGE);
    return active;
  }

  async findByVersion(
    organizationId: OrganizationId,
    version: number,
  ): Promise<DataKeyRecord | null> {
    const result = await this.transactions
      .current()
      .query<DataKeyRow>(
        `select ${READABLE_COLUMNS} from data_keys where organization_id = $1 and version = $2`,
        [organizationId, version],
      );
    return toRecord(result.rows[0]);
  }

  insertAsActive(): Promise<'inserted' | 'conflict'> {
    return Promise.reject(new Error('The inbound worker is not allowed to create data keys'));
  }
}

function toRecord(row: DataKeyRow | undefined): DataKeyRecord | null {
  if (row === undefined) return null;
  return {
    organizationId: row.organization_id as OrganizationId,
    version: row.version,
    wrapped: new Uint8Array(row.wrapped_dek),
    kmsKeyRef: row.kms_key_ref,
    status: row.status,
  };
}
