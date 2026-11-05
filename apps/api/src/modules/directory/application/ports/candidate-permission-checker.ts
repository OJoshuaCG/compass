import type { Rank, UserId } from '../../../../shared/kernel/index.js';

/**
 * Pregunta a `access` si quien recibiría una cuenta ya tiene los permisos que exige la reasignación de una
 * baja (ADR 0009, enmienda 2026-11-04). El adaptador vive en `access`: `directory` no lo importa.
 */
export interface CandidatePermissionChecker {
  /**
   * `true` solo si la persona tiene hoy `share.manage`, `credential.update` y `rotation.manage` dentro del
   * techo de su rango. Nunca se le otorga un permiso para que califique: quien no los tiene se salta.
   */
  hasRequiredPermissions(candidate: { readonly id: UserId; readonly rank: Rank }): Promise<boolean>;
}
