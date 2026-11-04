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

/**
 * Aviso a la Raíz de que el ancla de una organización falló (decisión del dueño del 2026-11-04). Corre en una
 * transacción propia de esa organización, con `app.org_id` fijado. El aviso solo dice que una tarea programada
 * falló y cuándo: ni el motivo, ni hashes, ni datos del bucket.
 */
export interface AnchorFailureAlerter {
  alertAnchorFailed(occurredAt: Date): Promise<void>;
}
