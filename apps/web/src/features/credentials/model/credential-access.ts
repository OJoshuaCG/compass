import type { ShareLevel } from '@iam/contracts';

/**
 * Orden de los niveles de acceso a una cuenta. Refleja `apps/api/src/modules/vault/domain/share-level.ts`.
 * Aquí solo sirve de comodidad para la interfaz: el servidor vuelve a decidir y puede negar la acción.
 */
const LEVEL_RANK: Readonly<Record<ShareLevel, number>> = {
  USE: 1,
  VIEW: 2,
  EDIT: 3,
  MANAGE: 4,
};

function levelSatisfies(actual: ShareLevel | null, required: ShareLevel): boolean {
  if (actual === null) return false;
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/** Copiar el usuario exige nivel USE y ningún permiso del catálogo. */
export function canCopyUsername(myLevel: ShareLevel | null): boolean {
  return levelSatisfies(myLevel, 'USE');
}

/** Revelar exige el permiso `credential.reveal_password` Y nivel VIEW o superior. */
export function canRevealPassword(
  hasRevealPermission: boolean,
  myLevel: ShareLevel | null,
): boolean {
  return hasRevealPermission && levelSatisfies(myLevel, 'VIEW');
}

/** Crear una credencial exige el permiso `credential.create` Y nivel EDIT. */
export function canCreateCredential(
  hasCreatePermission: boolean,
  myLevel: ShareLevel | null,
): boolean {
  return hasCreatePermission && levelSatisfies(myLevel, 'EDIT');
}

/** Cambiar la contraseña exige el permiso `credential.update` Y nivel EDIT. */
export function canChangePassword(
  hasUpdatePermission: boolean,
  myLevel: ShareLevel | null,
): boolean {
  return hasUpdatePermission && levelSatisfies(myLevel, 'EDIT');
}

/**
 * Restaurar una versión anterior de la contraseña exige el permiso `credential.restore_version` Y
 * nivel EDIT. Es un permiso propio: `credential.update` ya no basta.
 */
export function canRestoreVersion(
  hasRestoreVersionPermission: boolean,
  myLevel: ShareLevel | null,
): boolean {
  return hasRestoreVersionPermission && levelSatisfies(myLevel, 'EDIT');
}

/** Ver el estado del segundo factor y pedir códigos exige el permiso `credential.use_totp` Y nivel USE. */
export function canUseTotp(hasUseTotpPermission: boolean, myLevel: ShareLevel | null): boolean {
  return hasUseTotpPermission && levelSatisfies(myLevel, 'USE');
}

/** Registrar, confirmar y retirar el segundo factor exige `credential.update` Y nivel EDIT. */
export function canEditTotp(hasUpdatePermission: boolean, myLevel: ShareLevel | null): boolean {
  return hasUpdatePermission && levelSatisfies(myLevel, 'EDIT');
}

/** Exportar la clave exige el permiso `credential.export_totp` Y nivel MANAGE (un Operador no lo tiene). */
export function canExportTotp(hasExportPermission: boolean, myLevel: ShareLevel | null): boolean {
  return hasExportPermission && levelSatisfies(myLevel, 'MANAGE');
}

/** El historial exige nivel EDIT y ningún permiso adicional. */
export function canViewHistory(myLevel: ShareLevel | null): boolean {
  return levelSatisfies(myLevel, 'EDIT');
}
