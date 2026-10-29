import type { ShareLevel } from '@iam/contracts';

import type { KeysetPage, KeysetRequest, UserId } from '../../../../shared/kernel/index.js';

export interface PlatformRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly loginUrl: string | null;
  readonly supportsTotp: boolean;
  readonly isGlobal: boolean;
}

export interface AccountRecord {
  readonly id: string;
  readonly platformId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly ownerGroupId: string | null;
  readonly tags: readonly string[];
  readonly status: 'active' | 'archived';
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Identidad de negocio de una cuenta existente para detectar duplicados al importar. */
export interface ExistingAccountKey {
  readonly platformId: string;
  readonly displayName: string;
}

/** Una cuenta con el nivel de acceso de quien la consulta; `null` en el inventario, que no concede acceso. */
export interface AccountView extends AccountRecord {
  readonly myLevel: ShareLevel | null;
}

export interface NewAccount {
  readonly id: string;
  readonly platformId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly ownerGroupId: string | null;
  readonly tags: readonly string[];
  readonly createdBy: UserId;
}

/** Valores finales de los campos editables: el caso de uso mezcla lo recibido con lo vigente. */
export interface AccountEdit {
  readonly displayName: string;
  readonly handle: string | null;
  readonly ownerGroupId: string | null;
  readonly tags: readonly string[];
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface AccountRepository {
  /** Catálogo global más las plataformas propias de la organización; sin las archivadas. */
  listPlatforms(): Promise<readonly PlatformRecord[]>;
  /** La plataforma existe y la organización la puede usar (global o propia, no archivada). */
  platformIsUsable(platformId: string): Promise<boolean>;
  /** El grupo existe en la organización y no está archivado. */
  groupIsLive(groupId: string): Promise<boolean>;
  insert(account: NewAccount): Promise<AccountRecord>;
  /** Comparte la cuenta directamente con una persona; se usa para dar MANAGE a quien la crea. */
  insertUserShare(input: {
    readonly id: string;
    readonly accountId: string;
    readonly userId: UserId;
    readonly level: ShareLevel;
    readonly grantedBy: UserId;
  }): Promise<void>;
  findById(accountId: string): Promise<AccountRecord | null>;
  /** Bloquea la fila hasta el fin de la transacción: editar y archivar no se pisan entre sí. */
  findByIdForUpdate(accountId: string): Promise<AccountRecord | null>;
  /**
   * Nivel con el que la persona accede a la cuenta (comparticiones directas y por grupo vigentes), o
   * `null` si no tiene ninguno. Es la única fuente del acceso: nada se calcula en memoria.
   */
  effectiveLevel(accountId: string, userId: UserId): Promise<ShareLevel | null>;
  update(accountId: string, edit: AccountEdit): Promise<AccountRecord>;
  /** Archiva la cuenta y revoca todas sus comparticiones vigentes; devuelve cuántas revocó. */
  archive(input: {
    readonly accountId: string;
    readonly at: Date;
    readonly revokedBy: UserId;
  }): Promise<{ readonly revokedShares: number }>;
  /** Cuentas activas a las que la persona accede, por nombre. */
  listVisiblePage(userId: UserId, page: KeysetRequest): Promise<KeysetPage<AccountView>>;
  /**
   * Claves (plataforma y nombre visible) de las cuentas activas a las que la persona accede y cuyo nombre
   * coincide, sin distinguir mayúsculas, con alguno de `displayNames`. Solo cuentas con acceso efectivo:
   * la importación no debe revelar que existe una cuenta ajena.
   */
  findVisibleKeysByNames(
    userId: UserId,
    displayNames: readonly string[],
  ): Promise<readonly ExistingAccountKey[]>;
  /** Todas las cuentas activas de la organización (solo metadatos), por nombre. */
  listInventoryPage(page: KeysetRequest): Promise<KeysetPage<AccountView>>;
}
