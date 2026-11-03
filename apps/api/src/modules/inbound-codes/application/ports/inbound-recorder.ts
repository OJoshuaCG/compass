import type { InboundItemKind } from '../../domain/inbound-template.js';
import type { ItemVisibility } from '../../domain/inbound-classification.js';
import type { QuarantineReason } from '../../domain/inbound-evaluation.js';
import type { InboundTemplate } from '../../domain/inbound-template.js';
import type { SourceRef } from './poll-state-store.js';

export type RecordOutcome = 'recorded' | 'duplicate';

export interface AcceptedRecord {
  readonly fingerprint: string;
  readonly receivedAt: Date;
  readonly templateId: string;
  readonly kind: InboundItemKind;
  readonly visibility: ItemVisibility;
  readonly valueType: 'code' | 'link';
  /** Valor en claro; lo cifra el adaptador dentro de la transacción del mensaje. */
  readonly value: string;
  readonly expiresAt: Date;
  readonly signingDomain: string;
}

export interface QuarantineRecord {
  readonly fingerprint: string;
  readonly receivedAt: Date;
  readonly reason: QuarantineReason;
}

/**
 * Registro de un mensaje: UN mensaje, UNA transacción corta, en el orden elemento y luego recibo
 * (ADR 0045, paso 13). Idempotente: si el recibo ya existe devuelve `duplicate` sin dejar elemento.
 */
export interface InboundRecorder {
  hasReceipt(source: SourceRef, fingerprint: string): Promise<boolean>;
  recordAccepted(source: SourceRef, record: AcceptedRecord): Promise<RecordOutcome>;
  recordQuarantine(source: SourceRef, record: QuarantineRecord): Promise<RecordOutcome>;
}

/** Plantillas vigentes de las vistas de una fuente (solo las no archivadas). */
export interface SourceTemplateStore {
  listForSource(source: SourceRef): Promise<readonly InboundTemplate[]>;
}

/** Huellas; el adaptador usa `sha256Hex` de la fachada de criptografía. */
export interface MessageFingerprinter {
  /** Sobre el id de la fuente y los bytes crudos. */
  forRawMessage(sourceId: string, rawMessage: Uint8Array): string;
  /** Para un mensaje que no se descargó: id de la fuente, `UIDVALIDITY` y `UID`. */
  forMailboxPosition(sourceId: string, uidValidity: number, uid: number): string;
}
