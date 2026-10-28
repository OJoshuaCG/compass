/**
 * Agrupa las negaciones repetidas para que una ráfaga no infle la auditoría ni compita por el
 * advisory lock de la organización (ADR 0022, ADR 0023).
 *
 * Invariantes de seguridad
 * - La primera negación de cada clave dentro de una ventana SIEMPRE se audita: nunca se pierde la
 *   evidencia de que una persona intentó una acción negada. La clave incluye la organización, porque
 *   cada organización tiene su propio rastro.
 * - La ventana solo se abre cuando el llamador confirma que el evento se escribió (`confirmRecorded`):
 *   si la escritura falla, la siguiente negación idéntica vuelve a intentar auditarse (falla cerrada).
 * - Las repetidas de la misma clave dentro de la ventana no escriben evento; se cuentan y el total
 *   viaja en el siguiente evento auditado de esa clave (`suppressedCount`).
 * - El conteo de repetidas es de MEJOR ESFUERZO: se pierde si la clave no vuelve a negarse, si el
 *   proceso se reinicia o si la clave se expulsa por el tope de memoria. La primera negación nunca se
 *   pierde. Vaciarlo con un temporizador exigiría auditar fuera de una petición (pendiente, ADR 0022).
 * - El estado vive en memoria (ADR 0039: instancia única) y está acotado: al llegar al máximo de
 *   claves se descartan las más antiguas.
 */
import type { Clock } from '../../../shared/kernel/index.js';

/** Ventana en la que las negaciones idénticas se agrupan (60 s: una ráfaga, no un patrón lento). */
export const DENIAL_GROUPING_WINDOW_MS = 60_000;

/** Tope de claves en memoria; evita que un atacante con muchas combinaciones agote la memoria. */
export const DENIAL_GROUPING_MAX_KEYS = 10_000;

export interface DenialKey {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly code: string;
  readonly permission: string;
  readonly targetUserId: string | null;
}

export type DenialGroupingDecision =
  { readonly record: true; readonly suppressedCount: number } | { readonly record: false };

interface GroupState {
  windowStartedAtMs: number;
  suppressedCount: number;
}

export class DenialGrouper {
  private readonly groups = new Map<string, GroupState>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number = DENIAL_GROUPING_WINDOW_MS,
    private readonly maxKeys: number = DENIAL_GROUPING_MAX_KEYS,
  ) {}

  /**
   * Decide si esta negación se escribe en la auditoría o se acumula en el grupo vigente. No abre la
   * ventana: eso ocurre en `confirmRecorded`, una vez que el evento quedó escrito.
   */
  decide(key: DenialKey): DenialGroupingDecision {
    const groupKey = this.keyOf(key);
    const state = this.groups.get(groupKey);

    if (state !== undefined && this.isWindowOpen(state)) {
      state.suppressedCount += 1;
      return { record: false };
    }
    return { record: true, suppressedCount: state?.suppressedCount ?? 0 };
  }

  /** El evento se escribió: abre la ventana y descuenta las repeticiones que ya viajaron en él. */
  confirmRecorded(key: DenialKey, carriedSuppressedCount: number): void {
    const groupKey = this.keyOf(key);
    const state = this.groups.get(groupKey);
    const stillPending = Math.max(0, (state?.suppressedCount ?? 0) - carriedSuppressedCount);

    // Se reinserta para que el orden del Map siga siendo el de antigüedad de la ventana.
    this.groups.delete(groupKey);
    this.groups.set(groupKey, {
      windowStartedAtMs: this.clock.now().getTime(),
      suppressedCount: stillPending,
    });
    this.evictOldestWhenFull();
  }

  private isWindowOpen(state: GroupState): boolean {
    const elapsedMs = this.clock.now().getTime() - state.windowStartedAtMs;
    // Un reloj que retrocede (NTP, reanudación de una VM) no debe silenciar negaciones sin límite.
    if (elapsedMs < 0) return false;
    return elapsedMs < this.windowMs;
  }

  private keyOf(key: DenialKey): string {
    return JSON.stringify([
      key.organizationId,
      key.actorId,
      key.code,
      key.permission,
      key.targetUserId,
    ]);
  }

  private evictOldestWhenFull(): void {
    while (this.groups.size > this.maxKeys) {
      const oldestKey = this.groups.keys().next().value;
      if (oldestKey === undefined) return;
      this.groups.delete(oldestKey);
    }
  }
}
