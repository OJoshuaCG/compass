import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Nombre fijo con el que la plataforma crea cada plantilla del sistema → rango que representa. Los
 * nombres viven en `apps/api/src/modules/access/domain/system-roles.ts` y no se traducen en la base:
 * la interfaz los muestra con el nombre del rango en el idioma activo.
 */
const SYSTEM_TEMPLATE_RANK: Readonly<Record<string, number>> = {
  Root: 0,
  Administrator: 1,
  Leader: 2,
  Operator: 3,
};

/**
 * Nombre visible de un rol: las plantillas del sistema se traducen; los roles personalizados se
 * muestran tal cual los escribió quien los creó. Solo se traduce si el rol es de sistema, para no
 * confundir un rol personalizado que alguien haya llamado igual.
 */
export function useRoleLabel(): (role: { name: string; isSystem: boolean }) => string {
  const { t } = useTranslation('common');
  return useCallback(
    (role) => {
      const rank = role.isSystem ? SYSTEM_TEMPLATE_RANK[role.name] : undefined;
      return rank === undefined ? role.name : t(`rank.${String(rank)}`);
    },
    [t],
  );
}
