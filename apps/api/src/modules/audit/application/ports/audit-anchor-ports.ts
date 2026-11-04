import type { OrganizationId } from '../../../../shared/kernel/index.js';
import type { AuditAnchor, AuditAnchorManifest } from '../../domain/audit-anchor.js';

/** Recorrido de organizaciones del trabajo de anclaje: solo identificadores. */
export interface AnchorOrganizationLister {
  listIds(): Promise<readonly OrganizationId[]>;
}

/**
 * Registro local de anclas (`audit_anchors`). Corre en la transacción en curso, con `app.org_id` fijado: la
 * base asigna número, cabeza de la cadena y hashes, y devuelve lo que asignó.
 */
export interface AuditAnchorLedger {
  record(organizationId: OrganizationId): Promise<AuditAnchor>;
}

/**
 * Destino inmutable del manifiesto (bucket con Object Lock en modo de cumplimiento, ADR 0042). `retainUntil`
 * es la fecha hasta la que nadie puede borrar ni sobrescribir esa versión del objeto.
 */
export interface AuditAnchorPublisher {
  publish(manifest: AuditAnchorManifest, retainUntil: Date): Promise<void>;
}
