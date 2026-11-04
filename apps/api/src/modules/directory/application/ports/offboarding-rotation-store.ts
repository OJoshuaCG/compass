export type OffboardingRotationPriority = 'high' | 'normal';

export interface LiveCredentialRef {
  readonly credentialId: string;
  readonly accountId: string;
}

export interface NewOffboardingRotationTask {
  readonly credentialId: string;
  /** Quien se da de baja: es el disparador de la tarea. */
  readonly triggeredBy: string;
  readonly assignedTo: string;
  readonly priority: OffboardingRotationPriority;
  readonly dueAt: Date;
}

/**
 * Lo que la baja necesita para exigir la rotación de credenciales (governance §2.4). El adaptador vive en
 * `vault`. Todo corre en la transacción de la baja, que ya tiene el bloqueo de jerarquía: dos bajas de la
 * misma organización no se solapan, así que la deduplicación por consulta es segura.
 */
export interface OffboardingRotationStore {
  /** Credenciales vivas (no archivadas) de las cuentas indicadas. */
  listLiveCredentials(accountIds: readonly string[]): Promise<readonly LiveCredentialRef[]>;
  /** De las credenciales indicadas, las que la persona reveló alguna vez (según la auditoría). */
  listRevealedCredentialIds(input: {
    readonly userId: string;
    readonly credentialIds: readonly string[];
  }): Promise<readonly string[]>;
  /**
   * Deja una tarea `user_deactivated` vigente por credencial: la crea, o endurece la pendiente o en curso que
   * ya haya (plazo más corto, prioridad más alta y, si su responsable ya no está activo, el nuevo).
   * Devuelve cuántas credenciales quedaron cubiertas, creadas o endurecidas.
   */
  createTasks(tasks: readonly NewOffboardingRotationTask[]): Promise<number>;
}
