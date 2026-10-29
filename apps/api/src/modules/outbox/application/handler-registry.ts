import type { OutboxEventHandler } from '../domain/outbox-event.js';

/** Manejadores por `type` de evento. Se llena al componer la aplicación, antes de arrancar el trabajador. */
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxEventHandler>();

  register(type: string, handler: OutboxEventHandler): void {
    if (type.length === 0) throw new Error('An outbox event type must not be empty');
    // Dos manejadores para un mismo tipo harían que uno de los efectos se pierda en silencio.
    if (this.handlers.has(type)) throw new Error('An outbox handler is already registered');
    this.handlers.set(type, handler);
  }

  find(type: string): OutboxEventHandler | undefined {
    return this.handlers.get(type);
  }
}
