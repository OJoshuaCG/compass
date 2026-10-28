import { DomainError } from '../../../shared/kernel/index.js';
import type { AuditMetadata, AuditMetadataValue } from './audit-event.js';

/**
 * Lista blanca de campos de `metadata` por acción. Una acción sin entrada no admite metadatos:
 * es la barrera que impide que un secreto (ni siquiera parcial) llegue a la auditoría por descuido.
 * Para auditar un campo nuevo hay que registrarlo aquí, y eso se revisa como código protegido.
 */
export const AUDIT_METADATA_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  // Solo números de versión y el motivo (`scheduled` | `incident`); nunca material de clave.
  'crypto.dek_rotated': ['fromVersion', 'toVersion', 'reason'],
  'user.invited': ['rank', 'roleCount'],
  'user.invitation_resent': ['rank', 'roleCount'],
  'role.created': ['permissionCount'],
  'role.updated': ['addedCount', 'removedCount', 'renamed'],
  'role.archived': [],
  'user.deactivated': ['rotationTasks', 'reassignedReports'],
  'user.suspended': [],
  'user.reactivated': [],
  'user.rank_changed': ['fromRank', 'toRank'],
  'user.manager_changed': ['newManagerId'],
  'authz.denied': ['permission', 'resourceType', 'suppressedCount'],
  // Cuentas de la bóveda. `revokedShares`: comparticiones que se cerraron al archivar.
  'account.created': ['platformId', 'hasOwnerGroup'],
  'account.updated': ['changedFields'],
  'account.archived': ['revokedShares'],
  // Credenciales: nunca el contenido. `version` es el número de versión de la contraseña.
  'credential.created': ['kind'],
  'credential.password_changed': ['version'],
  'credential.username_copied': [],
  'credential.revealed': ['reason'],
  // Evento crítico: la persona superó el tope de revelaciones por hora (ADR 0031); `limit` es el tope vigente.
  'credential.reveal_limit_exceeded': ['limit'],
  'credential.totp_code_issued': [],
  'credential.totp_exported': ['reason'],
  'access.emergency_granted': ['reason', 'expiresInMinutes'],
  'share.revoked': ['level', 'rotationTaskCreated'],
  'audit.chain_verified': ['checked'],
  'auth.login_failed': [],
  'auth.login_password_verified': [],
  'auth.mfa_verified': [],
  'auth.mfa_failed': [],
  'auth.recovery_code_used': [],
  'auth.passkey_login': [],
  'auth.passkey_registered': [],
  'auth.passkey_revoked': [],
  'auth.passkey_registration_failed': [],
  'auth.passkey_revoke_failed': [],
  'auth.emergency_code_used': ['alertRecipients'],
  'auth.emergency_alert_incomplete': ['recipients', 'failed'],
  // `kind`: qué aviso a la persona no salió (recovery_code_used, passkey_added, passkey_removed).
  'auth.security_notice_failed': ['kind'],
  'auth.root_recovered': ['codesIssued', 'alertRecipients'],
  'auth.root_recovery_rejected': [],
  'auth.totp_enrolled': [],
  'auth.reauthenticated': [],
  'auth.reauthenticated_passkey': [],
  'auth.reauth_failed': [],
  'auth.logout': [],
  'auth.session_revoked': [],
  'user.sessions_revoked': [],
  'auth.password_changed': [],
  'organization.provisioned': [],
  'auth.password_change_failed': [],
  'user.invitation_accepted': [],
  // Reservadas para el broker (fase 7); existen para que los nombres no choquen después.
  'credential.injected': [],
  'broker.session.started': [],
  'credential.rotated_by_system': [],
};

const ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const MAX_STRING_LENGTH = 256;
/**
 * Campos de texto libre que admiten más de 256 caracteres. El motivo escrito de una revelación llega a
 * 500 (`REVEAL_REASON_MAX_LENGTH`): truncarlo dejaría un rastro incompleto de por qué se abrió un secreto.
 */
const FIELD_MAX_STRING_LENGTH: Readonly<Record<string, number>> = { reason: 500 };

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
    const maxLength = FIELD_MAX_STRING_LENGTH[field] ?? MAX_STRING_LENGTH;
    if (typeof value === 'string' && value.length > maxLength) {
      throw new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'Audit metadata value too long', {
        action,
        field,
      });
    }
    clean[field] = value;
  }
  return clean;
}
