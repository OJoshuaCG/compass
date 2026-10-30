import type { ShareGranteeType, ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

/** Una compartición viva que la persona otorgó sobre una cuenta de la bóveda. */
export interface SharedAccountSummary {
  readonly shareId: string;
  readonly accountId: string;
  readonly granteeType: ShareGranteeType;
  readonly granteeId: string;
  readonly level: ShareLevel;
  readonly expiresAt: Date | null;
}

/** Una página acotada de comparticiones junto con el total real, para no perder el conteo al truncar. */
export interface SharedAccountsSummaryPage {
  readonly total: number;
  readonly rows: readonly SharedAccountSummary[];
}

/**
 * Comparticiones vivas otorgadas por una persona. La implementación vive en la bóveda; `directory`
 * solo la consulta para avisar de lo que quedó compartido al bajar de rango (no se revoca nada).
 */
export interface SharedByLister {
  /** Vivas = sin revocar y sin vencer en `now`. Devuelve como máximo `limit` filas y el total. */
  listLiveGrantedBy(userId: UserId, now: Date, limit: number): Promise<SharedAccountsSummaryPage>;
}
