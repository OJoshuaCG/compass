import { PERMISSIONS, type Permission } from '@iam/contracts';

export type PermissionGroup = {
  /** Prefijo del permiso (`user` en `user.invite`): también la clave de su etiqueta. */
  id: string;
  permissions: Permission[];
};

/**
 * Agrupa permisos por área (el prefijo antes del primer punto) conservando el orden del
 * catálogo del contrato, para que la interfaz no dependa del orden en que llegan. Ignora lo que no
 * esté en el catálogo y omite las áreas vacías.
 */
export function groupPermissions(permissions: readonly string[]): PermissionGroup[] {
  const wanted = new Set(permissions);
  const groups = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    if (!wanted.has(permission)) continue;
    const id = permission.split('.')[0] ?? permission;
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [permission]);
    else group.push(permission);
  }
  return [...groups].map(([id, items]) => ({ id, permissions: items }));
}
