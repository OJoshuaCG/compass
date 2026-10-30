/**
 * Catálogo de permisos (plan: "Catálogo de permisos"). Es la única lista: el backend le agrega el
 * techo de rango de cada uno y el frontend la usa para mostrar u ocultar acciones. La interfaz
 * nunca es la autorización: el backend decide siempre.
 */
export const PERMISSIONS = [
  'org.settings',
  'role.manage',
  'platform.manage',
  'vault.inventory.read',
  'vault.emergency_access',
  'audit.read_all',
  'sso.clients.manage',
  'user.invite',
  'user.update',
  'user.change_rank',
  'user.transfer',
  'user.deactivate',
  'role.assign',
  'group.create',
  'group.manage_members',
  'account.create',
  'account.update',
  'account.archive',
  'credential.create',
  'credential.update',
  'credential.restore_version',
  'credential.reveal_password',
  'credential.use_totp',
  'credential.export_totp',
  'share.manage',
  'access_request.approve',
  'rotation.manage',
  'audit.read_scope',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
