import type { UserId } from '../../../../shared/kernel/index.js';

/**
 * Intercambio de rangos y responsables entre la Raíz que se va y la que llega. Implementado por el adaptador
 * de `directory` sobre la tabla de usuarios; las restricciones de la base (una Raíz activa, la Raíz no tiene
 * responsable) obligan a hacerlo en este orden y en una sola transacción.
 */
export interface RootHierarchySwap {
  /**
   * La Raíz anterior pasa a Administradora con responsable la nueva Raíz; la nueva pasa a rango 0 sin
   * responsable; los demás subordinados de la anterior pasan a depender de la nueva. Devuelve cuántos
   * subordinados se reasignaron.
   */
  swapRoot(input: { readonly fromUserId: UserId; readonly toUserId: UserId }): Promise<number>;
}

/** Roles que acompañan el cambio de rango. Implementado por `access`. */
export interface RootRoleHandover {
  /** La nueva Raíz recibe el rol de sistema Root. */
  promote(input: { readonly userId: UserId; readonly grantedBy: UserId }): Promise<void>;
  /**
   * La Raíz anterior pierde el rol Root y todo permiso que supere el techo del Administrador; conserva los
   * demás roles y, si se queda sin ninguno, recibe la plantilla de Administrador.
   */
  demote(input: { readonly userId: UserId; readonly grantedBy: UserId }): Promise<void>;
}

/** Lo que la Raíz anterior pierde de su acceso. Implementado por `identity`. */
export interface RootAccessRevoker {
  /**
   * Cierra todas sus sesiones, revoca sus factores y la deja pendiente de registrarlos de nuevo.
   */
  revokeForReenrollment(userId: UserId, at: Date): Promise<void>;
}

/** Códigos de emergencia de la organización. Implementado por `provisioning`. */
export interface EmergencyCodeInvalidator {
  /** Anula todos los códigos de emergencia vigentes; devuelve cuántos anuló. */
  invalidateAll(at: Date): Promise<number>;
}
