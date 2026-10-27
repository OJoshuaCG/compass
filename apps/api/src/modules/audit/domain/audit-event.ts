import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';

export type AuditOutcome = 'success' | 'denied' | 'failure';

export type AuditMetadataValue = string | number | boolean | null;
export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

/** Lo que pide un caso de uso. La organización NO viaja aquí: sale del `RequestContext`. */
export interface AuditEventInput {
  /** Acción en formato `dominio.verbo` (por ejemplo, `credential.revealed`). */
  readonly action: string;
  readonly actorId: UserId | null;
  readonly targetType: string | null;
  /** UUID del recurso afectado (la columna de base de datos es `uuid`). */
  readonly targetId: string | null;
  readonly outcome: AuditOutcome;
  /** Código de motivo estable; obligatorio en negaciones. */
  readonly reasonCode: string | null;
  readonly ip: string | null;
  readonly requestId: string;
  readonly metadata: AuditMetadata;
}

/** Evento listo para insertar: el llamador ya resolvió identificador y organización. */
export interface NewAuditEvent extends AuditEventInput {
  readonly id: string;
  readonly organizationId: OrganizationId;
}

/**
 * Evento almacenado. `seq`, `prevHash`, `hash` y `createdAt` los asigna la base de datos en un
 * trigger (con un advisory lock por organización), por lo que la cadena no se puede bifurcar ni
 * falsear desde la aplicación. Los hashes van en hexadecimal.
 */
export interface AuditEvent extends NewAuditEvent {
  readonly seq: bigint;
  readonly createdAt: Date;
  readonly prevHash: string;
  readonly hash: string;
}

/** Resultado de verificar la cadena de la organización en curso. */
export type ChainVerification =
  { readonly valid: true } | { readonly valid: false; readonly firstBrokenSeq: bigint };
