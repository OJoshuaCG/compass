/**
 * Invariantes de seguridad
 * - Solo inserta la organización: el trigger `audit_anchors_chain` (migración 0033) asigna número, cabeza de
 *   la cadena, hash anterior, hash propio y fecha. La aplicación no puede anclar una cabeza inventada.
 * - Corre en la transacción en curso, con `app.org_id` fijado: la política de aislamiento rechaza una
 *   organización distinta de la fijada.
 * - El rol de la aplicación no tiene UPDATE ni DELETE sobre `audit_anchors`.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { AuditAnchorLedger } from '../application/ports/audit-anchor-ports.js';
import type { AuditAnchor } from '../domain/audit-anchor.js';

/**
 * Espera máxima del bloqueo por organización del trigger. Una transacción que lo retuviera (otra ejecución
 * encimada, o una inserción rechazada que sigue abierta) no debe colgar el trabajo: falla esa organización y el
 * código de salida lo avisa.
 */
export const AUDIT_ANCHOR_LOCK_TIMEOUT_MS = 5000;

interface AuditAnchorRow {
  organization_id: string;
  manifest_number: string;
  anchored_seq: string;
  anchored_hash_hex: string;
  prev_manifest_hash_hex: string;
  manifest_hash_hex: string;
  anchored_at_micros: string;
}

export class PgAuditAnchorLedger implements AuditAnchorLedger {
  constructor(private readonly transactions: TransactionProvider) {}

  async record(organizationId: OrganizationId): Promise<AuditAnchor> {
    const client = this.transactions.current();
    // Local a la transacción: vence con ella y no afecta a otras consultas del mismo grupo de conexiones.
    await client.query("select set_config('lock_timeout', $1, true)", [
      `${String(AUDIT_ANCHOR_LOCK_TIMEOUT_MS)}ms`,
    ]);
    // Las columnas NOT NULL se comprueban después del trigger BEFORE INSERT, que las llena todas.
    const result = await client.query<AuditAnchorRow>(
      `insert into audit_anchors (organization_id)
       values ($1)
       returning organization_id,
                 manifest_number::text as manifest_number,
                 anchored_seq::text as anchored_seq,
                 encode(anchored_hash, 'hex') as anchored_hash_hex,
                 encode(prev_manifest_hash, 'hex') as prev_manifest_hash_hex,
                 encode(manifest_hash, 'hex') as manifest_hash_hex,
                 floor(extract(epoch from anchored_at) * 1000000)::bigint::text as anchored_at_micros`,
      [organizationId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Audit anchor insert returned no row');
    return {
      organizationId: asOrganizationId(row.organization_id),
      manifestNumber: BigInt(row.manifest_number),
      anchoredSeq: BigInt(row.anchored_seq),
      anchoredHash: row.anchored_hash_hex,
      prevManifestHash: row.prev_manifest_hash_hex,
      manifestHash: row.manifest_hash_hex,
      anchoredAtMicros: BigInt(row.anchored_at_micros),
    };
  }
}
