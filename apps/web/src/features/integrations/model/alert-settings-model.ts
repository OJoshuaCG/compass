import type { InfrastructureAlertChannels } from '@iam/contracts';

/**
 * Regla de negocio: la Raíz siempre debe tener por dónde enterarse. El servidor la vuelve a
 * validar (es la autoridad); aquí solo evita un viaje inútil y explica el motivo.
 */
export function hasActiveChannel(channels: InfrastructureAlertChannels): boolean {
  return channels.email || channels.telegram;
}
