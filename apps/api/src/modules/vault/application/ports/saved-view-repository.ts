import type { AccountListFilter } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

export interface SavedViewRecord {
  readonly id: string;
  readonly name: string;
  readonly searchText: string | null;
  readonly quickFilter: AccountListFilter | null;
  readonly createdAt: Date;
}

export interface NewSavedView {
  readonly id: string;
  readonly userId: UserId;
  readonly name: string;
  readonly searchText: string | null;
  readonly quickFilter: AccountListFilter | null;
}

/** Vistas guardadas del listado de cuentas. Toda consulta va acotada a la persona dueña. */
export interface SavedViewRepository {
  /** Serializa las altas de una persona hasta el fin de la transacción, para que el máximo no se rebase. */
  lockUser(userId: UserId): Promise<void>;
  listByUser(userId: UserId): Promise<readonly SavedViewRecord[]>;
  countByUser(userId: UserId): Promise<number>;
  /** `false` si la persona ya tiene una vista con ese nombre (sin distinguir mayúsculas). */
  insert(view: NewSavedView): Promise<boolean>;
  /** `false` si la vista no existe o no es de esa persona. */
  deleteOwned(userId: UserId, viewId: string): Promise<boolean>;
}
