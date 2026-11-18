/**
 * Puertos del detector de eventos en cuarentena. Todos operan sobre la organización en curso (la
 * transacción ya trae `app.org_id`) y ninguno lee el contenido (`payload`) de los eventos.
 */

/** Cuenta los eventos del outbox que agotaron sus reintentos y esperan revisión humana. */
export interface QuarantinedEventCounter {
  countQuarantinedEvents(): Promise<number>;
}

/** Evita repetir el aviso: pregunta si ya se encoló una alerta de cuarentena desde un instante dado. */
export interface QuarantineAlertHistory {
  hasQuarantineAlertSince(since: Date): Promise<boolean>;
}

/** Encola la alerta de cuarentena para la Raíz de la organización en curso. */
export interface QuarantineAlerter {
  alertQuarantinedEvents(occurredAt: Date): Promise<void>;
}
