import type { ShareGranteeType, ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

export interface ShareRecord {
  readonly id: string;
  readonly accountId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
  readonly grantedBy: string;
  readonly createdAt: Date;
}

/** Una compartición con el nombre visible de la persona o del grupo, para mostrarla. */
export interface ShareView extends ShareRecord {
  readonly granteeName: string;
}

export interface NewShare {
  readonly id: string;
  readonly accountId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
  readonly grantedBy: UserId;
}

/** Una credencial de la cuenta que la persona reveló mientras tenía acceso. */
export interface RevealedCredential {
  readonly userId: string;
  readonly credentialId: string;
}

export interface NewRotationTask {
  readonly credentialId: string;
  readonly triggeredByUser: string | null;
  readonly assignedTo: UserId;
  readonly dueAt: Date;
}

/** Una compartición viva tal como la necesita el aviso de cambio de rango (sin nombres de cuenta). */
export interface GrantedShareSummary {
  readonly shareId: string;
  readonly accountId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface ShareRepository {
  /** Comparticiones vigentes de la cuenta: sin revocar y sin vencer. */
  listLive(accountId: string, now: Date): Promise<readonly ShareView[]>;
  /**
   * Comparticiones vivas (sin revocar y sin vencer en `now`) que `userId` otorgó, de la más antigua a
   * la más reciente, con a lo sumo `limit` filas y el total real aunque se trunque.
   */
  listLiveGrantedBy(
    userId: string,
    now: Date,
    limit: number,
  ): Promise<{ readonly total: number; readonly rows: readonly GrantedShareSummary[] }>;
  findViewById(accountId: string, shareId: string): Promise<ShareView | null>;
  /**
   * La compartición sin revocar de ese destinatario, aunque ya haya vencido: el índice único parcial
   * `shares_one_live_per_grantee` solo mira `revoked_at`, así que una vencida sin revocar también estorba.
   */
  findOpenByGrantee(
    accountId: string,
    granteeType: ShareGranteeType,
    granteeId: string,
  ): Promise<ShareRecord | null>;
  findOpenById(accountId: string, shareId: string): Promise<ShareRecord | null>;
  insert(share: NewShare): Promise<void>;
  /** Marca la compartición como revocada; conserva la fila (quién tuvo acceso y cuándo es dato forense). */
  revoke(shareId: string, at: Date, revokedBy: UserId): Promise<void>;
  /** La persona existe en la organización y su estado es `active`. */
  userIsActive(userId: string): Promise<boolean>;
  /** Personas que hoy pertenecen al grupo. */
  groupMemberIds(groupId: string): Promise<readonly string[]>;
  /**
   * Credenciales de la cuenta que alguna de esas personas reveló con éxito desde `since`. La fuente es la
   * auditoría (`credential.revealed`): no existe otra marca de "esta persona vio la contraseña".
   */
  revealedCredentials(
    accountId: string,
    userIds: readonly string[],
    since: Date,
  ): Promise<readonly RevealedCredential[]>;
  /** Hay una tarea de rotación sin cerrar de esta credencial por una compartición revocada. */
  openRotationTaskExists(credentialId: string): Promise<boolean>;
  insertRotationTask(task: NewRotationTask): Promise<void>;
}
