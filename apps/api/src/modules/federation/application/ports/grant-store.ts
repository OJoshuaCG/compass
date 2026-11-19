import type { BackchannelLogoutTarget } from '../../domain/backchannel-logout.js';

/**
 * Borrado de concesiones OIDC (`oidc_payloads`). Corre en la transacción del llamador, bajo aislamiento
 * por filas, para que la revocación y la auditoría confirmen juntas (ADR 0051 §3).
 */
export interface GrantStore {
  /** Aplicaciones con sesión del proveedor abierta ligada a esas sesiones de Compass (leer ANTES de borrar). */
  findLogoutTargetsBySessions(
    sessionIds: readonly string[],
  ): Promise<readonly BackchannelLogoutTarget[]>;
  findLogoutTargetsByUserExceptSession(
    userId: string,
    keepSessionId: string,
  ): Promise<readonly BackchannelLogoutTarget[]>;
  findLogoutTargetsByUser(userId: string): Promise<readonly BackchannelLogoutTarget[]>;
  /** Borra todo lo ligado a esas sesiones de Compass. Devuelve cuántas filas se borraron. */
  deleteBySessions(sessionIds: readonly string[]): Promise<number>;
  /** Borra lo de la persona ligado a cualquier sesión de Compass salvo la indicada (cambio de contraseña). */
  deleteByUserExceptSession(userId: string, keepSessionId: string): Promise<number>;
  /** Borra todo lo de una persona, tenga o no sesión viva (desactivar o suspender, ADR 0051 §3). */
  deleteByUser(userId: string): Promise<number>;
}
