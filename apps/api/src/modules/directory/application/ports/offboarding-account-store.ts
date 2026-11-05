import type { UserId } from '../../../../shared/kernel/index.js';

/** Qué le pasó a la compartición de quien recibe la responsabilidad de una cuenta. */
export type ManagementGrantOutcome = 'granted' | 'upgraded';

/**
 * Lo que la baja de una persona necesita de la bóveda (ADR 0009, enmienda 2026-11-04). El adaptador vive
 * en `vault`: `directory` no importa la bóveda. Todo corre en la transacción de la baja, con la
 * organización fijada por RLS.
 */
export interface OffboardingAccountStore {
  /**
   * Cuentas activas cuyo ÚNICO gestor activo (nivel MANAGE, directo o por grupo) es `leaverId`, ordenadas
   * por id y bloqueadas hasta el fin de la transacción. Una cuenta con otro gestor activo no aparece.
   * Quien está suspendido, invitado o dado de baja NO cuenta como gestor activo, así que su cuenta puede
   * quedar huérfana aunque conserve la compartición.
   * Debe llamarse ANTES de mutar nada y bajo el bloqueo de jerarquía.
   */
  lockAccountsOnlyManagedBy(leaverId: UserId): Promise<readonly string[]>;
  /**
   * Deja a `granteeId` como gestor (MANAGE sin vencimiento) de la cuenta, con motivo `offboarding`. Si ya
   * tenía una compartición viva (aunque vencida) se sube de nivel, porque el índice único impide un
   * segundo alta. `grantedBy` es quien da la baja.
   */
  grantManagement(input: {
    readonly accountId: string;
    readonly granteeId: UserId;
    readonly grantedBy: UserId;
  }): Promise<ManagementGrantOutcome>;
}
