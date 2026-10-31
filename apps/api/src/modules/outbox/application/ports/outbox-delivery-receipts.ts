/**
 * Acuses de entrega de los manejadores del outbox (ADR 0035). El trabajador entrega AL MENOS una vez:
 * un manejador con efecto externo (un correo) consulta aquí si su efecto ya se hizo para ese evento y,
 * tras lograrlo, lo anota. La clave de idempotencia es el id del evento más el nombre estable del manejador.
 */
export interface OutboxDeliveryReceipts {
  /** ¿Ya se entregó el efecto de `handlerKey` para este evento? Lee en la transacción del trabajador. */
  wasDelivered(eventId: string, handlerKey: string): Promise<boolean>;
  /**
   * Anota la entrega en una transacción INDEPENDIENTE, confirmada en el acto. Así sobrevive si la
   * transacción del trabajador se revierte después (plazo vencido, caída de la conexión) y el
   * reintento no repite el efecto. Es idempotente: anotar dos veces no falla.
   */
  markDelivered(eventId: string, handlerKey: string): Promise<void>;
}
