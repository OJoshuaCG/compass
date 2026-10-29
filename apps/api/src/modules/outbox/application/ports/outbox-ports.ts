import type { OrganizationId } from '../../../../shared/kernel/index.js';

/** Recorrido de organizaciones (solo identificadores): el cableado usa `auth.list_organization_ids()`. */
export interface OutboxOrganizationSource {
  listIds(): Promise<readonly OrganizationId[]>;
}

/**
 * Registro del trabajador. Los campos permitidos son id de evento, tipo, organización, intento,
 * resultado y código de fallo; el contenido (`payload`) y los mensajes de error no se registran.
 */
export interface OutboxLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
