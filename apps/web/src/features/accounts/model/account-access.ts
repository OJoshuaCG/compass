import type { ShareLevel } from '@iam/contracts';

/**
 * Orden de los niveles de acceso a una cuenta. Refleja `apps/api/src/modules/vault/domain/share-level.ts`
 * (a su vez ligado a `share_level_rank` en la base de datos). Aquí solo sirve de comodidad para la
 * interfaz: el servidor vuelve a decidir con el nivel vigente y puede negar la acción.
 */
const LEVEL_RANK: Readonly<Record<ShareLevel, number>> = {
  USE: 1,
  VIEW: 2,
  EDIT: 3,
  MANAGE: 4,
};

/** Un nivel cubre al requerido cuando es igual o mayor: MANAGE incluye EDIT, que incluye VIEW, y así. */
export function levelSatisfies(actual: ShareLevel, required: ShareLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

/**
 * Editar exige el permiso `account.update` Y nivel EDIT o superior sobre la cuenta (el servidor
 * aplica las dos llaves). Sin nivel (`null`, como en el inventario) no hay acceso que ofrecer.
 */
export function canEditAccount(hasUpdatePermission: boolean, myLevel: ShareLevel | null): boolean {
  if (!hasUpdatePermission) return false;
  if (myLevel === null) return false;
  return levelSatisfies(myLevel, 'EDIT');
}

/** Archivar exige el permiso `account.archive` Y nivel MANAGE sobre la cuenta. */
export function canArchiveAccount(
  hasArchivePermission: boolean,
  myLevel: ShareLevel | null,
): boolean {
  if (!hasArchivePermission) return false;
  if (myLevel === null) return false;
  return levelSatisfies(myLevel, 'MANAGE');
}
