import { DomainError } from '../../../shared/kernel/index.js';
import type { AuditMetadata, AuditMetadataValue } from './audit-event.js';

/**
 * Lista blanca de campos de `metadata` por acción. Una acción sin entrada no admite metadatos:
 * es la barrera que impide que un secreto (ni siquiera parcial) llegue a la auditoría por descuido.
 * Para auditar un campo nuevo hay que registrarlo aquí, y eso se revisa como código protegido.
 */
export const AUDIT_METADATA_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'user.invited': ['rank', 'roleCount'],
  'user.deactivated': ['rotationTasks', 'reassignedReports'],
  'authz.denied': ['permission', 'resourceType'],
  'credential.revealed': ['reason'],
  'credential.totp_code_issued': [],
  'credential.totp_exported': ['reason'],
  'access.emergency_granted': ['reason', 'expiresInMinutes'],
  'share.revoked': ['level', 'rotationTaskCreated'],
  'audit.chain_verified': ['checked'],
  // Reservadas para el broker (fase 7); existen para que los nombres no choquen después.
  'credential.injected': [],
  'broker.session.started': [],
  'credential.rotated_by_system': [],
};

const ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const MAX_STRING_LENGTH = 256;

/**
 * Devuelve solo los campos permitidos. Un campo fuera de la lista o un valor no primitivo
 * se rechaza (no se descarta en silencio): un error visible es mejor que perder el rastro.
 */
export function sanitizeMetadata(action: string, metadata: AuditMetadata): AuditMetadata {
  if (!ACTION_PATTERN.test(action)) {
    throw new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'Invalid audit action name', {
      action,
    });
  }
  const allowed = AUDIT_METADATA_ALLOWLIST[action] ?? [];
  const clean: Record<string, AuditMetadataValue> = {};
  for (const [field, value] of Object.entries(metadata)) {
    if (!allowed.includes(field)) {
      throw new DomainError(
        'AUDIT.METADATA_FIELD_NOT_ALLOWED',
        'Audit metadata field not allowed',
        {
          action,
          field,
        },
      );
    }
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      throw new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'Audit metadata value too long', {
        action,
        field,
      });
    }
    clean[field] = value;
  }
  return clean;
}
