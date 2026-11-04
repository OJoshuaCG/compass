import type {
  AlertSettingsRecord,
  InfrastructureAlertChannels,
} from '../../domain/alert-settings.js';

export interface SaveAlertSettingsInput {
  readonly infrastructure: InfrastructureAlertChannels;
  readonly updatedBy: string;
  /** Versión leída antes de cambiar; 0 si no había fila. */
  readonly expectedVersion: number;
}

/** Ajustes de alerta de la organización fijada en la transacción en curso (RLS). */
export interface AlertSettingsStore {
  /** El ajuste guardado, o el valor por omisión con versión 0 si no hay fila. */
  find(): Promise<AlertSettingsRecord>;
  /**
   * Guarda el ajuste si la versión sigue siendo la esperada. Devuelve el ajuste nuevo, o `null` si otra
   * persona lo cambió entretanto (conflicto).
   */
  save(input: SaveAlertSettingsInput): Promise<AlertSettingsRecord | null>;
}
