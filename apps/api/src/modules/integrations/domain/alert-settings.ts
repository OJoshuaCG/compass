/**
 * Canales por los que la Raíz recibe las alertas de infraestructura (decisión del dueño del 2026-11-04):
 * «Que se pueda configurar la alerta, en un panel "root" para recibir estas alertas con opciones de
 * "Correo y/o Telegram"». Se guardan en `alert_settings` (migración 0034).
 */

export interface InfrastructureAlertChannels {
  /** Correo a todas las cuentas Raíz activas. */
  readonly email: boolean;
  /** Chat de Telegram de infraestructura, si hay uno activo. */
  readonly telegram: boolean;
}

/**
 * Sin ajuste guardado se avisa por ambos canales: conserva el aviso por Telegram que ya existía y suma el
 * correo, que es el canal principal (ADR 0047: Telegram complementa el correo, no lo reemplaza).
 */
export const DEFAULT_INFRASTRUCTURE_ALERT_CHANNELS: InfrastructureAlertChannels = {
  email: true,
  telegram: true,
};

/** Apagar los dos canales dejaría a la Raíz sin enterarse de que la plataforma falla. */
export function hasAtLeastOneChannel(channels: InfrastructureAlertChannels): boolean {
  return channels.email || channels.telegram;
}

/** Ajuste guardado, con quién y cuándo lo cambió por última vez. */
export interface AlertSettingsRecord {
  readonly infrastructure: InfrastructureAlertChannels;
  /** `null` cuando no hay fila y rige el valor por omisión. */
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
  /** 0 cuando no hay fila: la primera escritura inserta con versión 1. */
  readonly version: number;
}
