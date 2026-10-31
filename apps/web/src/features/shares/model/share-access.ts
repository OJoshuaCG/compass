import type { ShareLevel } from '@iam/contracts';

/**
 * Compartir y revocar exigen el permiso `share.manage` Y nivel MANAGE sobre la cuenta. Solo es
 * comodidad para la interfaz: el servidor vuelve a decidir y puede negar la acción (AUTHZ.SHARE).
 */
export function canManageShares(hasSharePermission: boolean, myLevel: ShareLevel | null): boolean {
  return hasSharePermission && myLevel === 'MANAGE';
}
