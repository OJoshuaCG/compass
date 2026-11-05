import type { ShareGranteeType, ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

/** Vista vigente con lo necesario para decidir si se puede compartir. */
export interface ShareableView {
  readonly id: string;
  readonly sourceId: string;
  /** Cuenta de la bóveda a la que está ligada la fuente, si la hay. */
  readonly accountId: string | null;
}

export interface ViewShareRecord {
  readonly id: string;
  readonly viewId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
  readonly grantedBy: string;
  readonly createdAt: Date;
}

/** Una compartición con el nombre visible de la persona o del grupo, para mostrarla. */
export interface ViewShareView extends ViewShareRecord {
  readonly granteeName: string;
}

export interface NewViewShare {
  readonly id: string;
  readonly viewId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
  readonly grantedBy: UserId;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface InboundViewShareRepository {
  /** Vista no archivada, sin bloquear. `null` si no existe o está archivada. */
  findView(viewId: string): Promise<ShareableView | null>;
  /** Igual que `findView`, pero bloquea la fila: dos cambios de comparticiones de la vista se serializan. */
  findViewForUpdate(viewId: string): Promise<ShareableView | null>;
  /** Nivel efectivo de la persona sobre la vista (directo o por grupo), o `null`. */
  viewLevel(viewId: string, userId: UserId): Promise<ShareLevel | null>;
  /** Bloquea en modo compartido la fila de la cuenta ligada: serializa contra quien revoca accesos a ella. */
  lockAccountForShare(accountId: string): Promise<void>;
  /**
   * Bloquea en modo exclusivo la fila de la cuenta ligada, como `ManageShares.revoke`: dos revocaciones
   * de vistas distintas ligadas a la misma cuenta no pueden crear dos veces la misma tarea de rotación.
   */
  lockAccountForRotation(accountId: string): Promise<void>;
  /** Nivel efectivo de la persona sobre la cuenta de la bóveda, o `null`. */
  accountLevel(accountId: string, userId: UserId): Promise<ShareLevel | null>;
  listLive(viewId: string, now: Date): Promise<readonly ViewShareView[]>;
  findViewShareById(viewId: string, shareId: string): Promise<ViewShareView | null>;
  /** Compartición sin revocar del destinatario, aunque haya vencido (el índice único solo mira `revoked_at`). */
  findOpenByGrantee(
    viewId: string,
    granteeType: ShareGranteeType,
    granteeId: string,
  ): Promise<ViewShareRecord | null>;
  findOpenById(viewId: string, shareId: string): Promise<ViewShareRecord | null>;
  insert(share: NewViewShare): Promise<void>;
  /** Marca como revocada y conserva la fila: quién tuvo acceso y cuándo es dato forense. */
  revoke(shareId: string, at: Date, revokedBy: UserId): Promise<void>;
  userIsActive(userId: string): Promise<boolean>;
  groupIsLive(groupId: string): Promise<boolean>;
  /** Miembros actuales del grupo, para saber a quién deja sin acceso revocar una compartición a grupo. */
  groupMemberIds(groupId: string): Promise<readonly string[]>;
  /**
   * De las personas dadas, quiénes revelaron con éxito un restablecimiento desde ESTA vista después de
   * `since` (según la auditoría `inbound.reset_revealed`). Sin duplicados.
   */
  usersWhoRevealedResets(
    viewId: string,
    userIds: readonly string[],
    since: Date,
  ): Promise<readonly string[]>;
  /** Credenciales no archivadas de la cuenta de la bóveda: las que una toma de la cuenta compromete. */
  liveCredentialIds(accountId: string): Promise<readonly string[]>;
}
