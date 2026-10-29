import type { ShareLevel } from '@iam/contracts';

/**
 * Orden de los niveles de acceso a una cuenta. Debe coincidir con `share_level_rank` en la base de
 * datos (migración 0007): el acceso efectivo se calcula allí y aquí solo se compara el resultado.
 */
const LEVEL_RANK: Readonly<Record<ShareLevel, number>> = {
  USE: 1,
  VIEW: 2,
  EDIT: 3,
  MANAGE: 4,
};

/** Un nivel cubre al requerido cuando es igual o mayor: MANAGE incluye EDIT, que incluye VIEW, y así. */
export const levelSatisfies = (actual: ShareLevel, required: ShareLevel): boolean =>
  LEVEL_RANK[actual] >= LEVEL_RANK[required];

/**
 * Techo de la compartición: nadie otorga un nivel superior al suyo (PE-7). Hoy compartir exige MANAGE, el
 * nivel máximo, así que el techo no recorta nada; se conserva como regla propia para que siga valiendo si
 * algún día se permite compartir con un nivel menor.
 */
export const canGrant = (grantorLevel: ShareLevel, requested: ShareLevel): boolean =>
  levelSatisfies(grantorLevel, requested);
