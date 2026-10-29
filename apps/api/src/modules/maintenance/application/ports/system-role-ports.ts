/** Rol de sistema vivo tal como está guardado en la organización en curso. */
export interface StoredSystemRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/**
 * Acceso a los roles de sistema de la organización en curso (la transacción ya trae `app.org_id`).
 * Nunca expone ni modifica roles personalizados.
 */
export interface SystemRoleStore {
  /** Roles con `is_system` y sin archivar. */
  listLiveSystemRoles(): Promise<readonly StoredSystemRole[]>;
  /** Reemplaza los permisos de un rol de sistema vivo y sube su versión. `false` si no se cambió ninguna fila. */
  replacePermissions(roleId: string, permissions: readonly string[]): Promise<boolean>;
}
