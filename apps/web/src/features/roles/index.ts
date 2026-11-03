/**
 * Fachada pública del feature `roles`: la pantalla "Roles" (roles personalizados y catálogo de
 * permisos) y lo que `directory` reutiliza para asignar permisos especiales a una persona.
 */
export { RoleEditorPage } from './containers/role-editor-page';
export { RolesPage } from './containers/roles-page';
export { fetchPermissionCatalog, rolesKeys } from './api/roles-api';
export { groupPermissions } from './model/permission-groups';
export { PermissionPicker } from './ui/permission-picker';
