/**
 * Regla de baja (docs/business/governance.md §2.4, ADR 0009, enmienda 2026-11-04): a quién se le da la
 * responsabilidad de una cuenta cuando su único responsable activo se va.
 *
 * Es una función pura: no consulta nada. Quien la llama le entrega la cadena de superiores ya resuelta
 * (del más cercano al más lejano), con dos hechos por persona que sí salen de la base de datos.
 *
 * Invariantes de seguridad
 * - Solo recibe la cuenta quien YA tiene por sí misma los permisos de compartir, editar credenciales y
 *   gestionar la rotación: la baja no puede saltarse el doble control de la bóveda.
 * - Nunca se elige a una persona suspendida, invitada o dada de baja.
 * - Nunca se elige a una persona del mismo nivel que la que se va ni a nadie fuera de la cadena de
 *   superiores: el sistema no escoge pares (decisión del dueño, hallazgo (b) de la revisión).
 */
import { RANK } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { UserStatus } from './user.js';

/** Un superior de la persona que se va, con lo que hace falta saber para decidir si recibe la cuenta. */
export interface ManagerCandidate {
  readonly id: UserId;
  readonly rank: Rank;
  readonly status: UserStatus;
  /** ¿Está en la rama de quien da la baja (o es esa persona)? */
  readonly inActorBranch: boolean;
  /** ¿Ya puede compartir, editar credenciales y gestionar la rotación por sí misma? */
  readonly hasRequiredPermissions: boolean;
}

/** Por qué se eligió a la persona, para auditarlo cuenta por cuenta. */
export type AccountManagerSelectionReason = 'branch' | 'nearest_administrator';

export type AccountManagerSelection =
  | {
      readonly outcome: 'assigned';
      readonly managerId: UserId;
      readonly reason: AccountManagerSelectionReason;
      /** Solo se notifica a quien recibe la cuenta fuera de la rama de quien dio la baja. */
      readonly notify: boolean;
    }
  | { readonly outcome: 'unassigned' };

/**
 * @param superiors cadena de superiores de quien se va, del más cercano al más lejano.
 */
export function selectAccountManager(
  superiors: readonly ManagerCandidate[],
): AccountManagerSelection {
  const eligible = superiors.filter(
    (candidate) => candidate.status === 'active' && candidate.hasRequiredPermissions,
  );

  const inBranch = eligible.find((candidate) => candidate.inActorBranch);
  if (inBranch !== undefined) {
    return { outcome: 'assigned', managerId: inBranch.id, reason: 'branch', notify: false };
  }

  // Fuera de la rama solo cuenta un Administrador: la Raíz y los rangos intermedios no son un respaldo.
  const nearestAdministrator = eligible.find((candidate) => candidate.rank === RANK.ADMINISTRATOR);
  if (nearestAdministrator !== undefined) {
    return {
      outcome: 'assigned',
      managerId: nearestAdministrator.id,
      reason: 'nearest_administrator',
      notify: true,
    };
  }

  return { outcome: 'unassigned' };
}
