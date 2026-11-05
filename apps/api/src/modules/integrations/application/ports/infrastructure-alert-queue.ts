import type { InfrastructureAlertPayload } from '../../domain/infrastructure-alert.js';

/**
 * Cola de alertas de infraestructura para la Raíz (outbox, ADR 0035). Quien detecta el problema encola el
 * código y la hora; el manejador `NotifyInfrastructureAlert` lo entrega por los canales elegidos en el panel.
 */
export interface InfrastructureAlertQueue {
  enqueue(alert: InfrastructureAlertPayload): Promise<void>;
}
