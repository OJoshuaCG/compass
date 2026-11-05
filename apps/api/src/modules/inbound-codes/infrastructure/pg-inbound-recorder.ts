/**
 * Invariantes de seguridad
 * - UN mensaje, UNA transacción corta, con la organización de la fuente fijada (aislamiento por filas).
 * - Orden fijo: primero el elemento y luego el recibo (ADR 0045, paso 13). El recibo es la deduplicación
 *   (restricción única); si ya existía, la transacción se revierte entera y no queda un elemento huérfano
 *   (el worker no tiene DELETE sobre `inbound_items`, así que revertir es la única forma de limpiarlo).
 * - El valor se cifra con el módulo de criptografía dentro de la transacción; nunca se guarda ni se
 *   registra en claro. El id del elemento se genera antes porque forma parte del contexto de cifrado.
 * - El recibo no lleva asunto, remitente ni valores: solo huella, resultado, motivo y dominio firmante.
 */
import type { IdGenerator } from '../../../shared/kernel/index.js';
import { err, ok } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type {
  AcceptedRecord,
  InboundRecorder,
  QuarantineRecord,
  RecordOutcome,
} from '../application/ports/inbound-recorder.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';
import { inboundItemContext } from '../domain/inbound-item-context.js';

export class PgInboundRecorder implements InboundRecorder {
  constructor(
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly cipher: SecretCipher,
    private readonly ids: IdGenerator,
  ) {}

  async hasReceipt(source: SourceRef, fingerprint: string): Promise<boolean> {
    return this.inSource(source, async () => {
      const result = await this.transactions.current().query(
        `select 1
           from inbound_receipts
          where organization_id = $1 and source_id = $2 and message_fingerprint = $3`,
        [source.organizationId, source.sourceId, fingerprint],
      );
      return result.rowCount === 1;
    });
  }

  async recordAccepted(source: SourceRef, record: AcceptedRecord): Promise<RecordOutcome> {
    const result = await this.scope.runAsAtomic<'recorded', 'duplicate'>(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      async () => {
        const itemId = this.ids.next();
        const plaintext = new TextEncoder().encode(record.value);
        try {
          const sealed = await this.cipher.encrypt(
            inboundItemContext(source.organizationId, itemId),
            plaintext,
          );
          // Un fallo del KMS o de la llave no es un mensaje malo: se propaga y el cursor no avanza.
          if (!sealed.ok) throw sealed.error;

          await this.transactions.current().query(
            `insert into inbound_items
               (id, organization_id, source_id, template_id, kind, value_type, visibility,
                ciphertext, nonce, dek_version, expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              itemId,
              source.organizationId,
              source.sourceId,
              record.templateId,
              record.kind,
              record.valueType,
              record.visibility,
              Buffer.from(sealed.value.ciphertext),
              Buffer.from(sealed.value.nonce),
              sealed.value.dekVersion,
              record.expiresAt,
            ],
          );
        } finally {
          plaintext.fill(0);
        }

        const receipt = await this.transactions.current().query(
          `insert into inbound_receipts
             (organization_id, source_id, message_fingerprint, outcome, signing_domain,
              template_kind, template_id, item_id, received_at)
           values ($1, $2, $3, 'accepted', $4, $5, $6, $7, $8)
           on conflict (organization_id, source_id, message_fingerprint) do nothing
           returning id`,
          [
            source.organizationId,
            source.sourceId,
            record.fingerprint,
            record.signingDomain,
            record.kind,
            record.templateId,
            itemId,
            record.receivedAt,
          ],
        );
        return receipt.rowCount === 1 ? ok('recorded' as const) : err('duplicate' as const);
      },
    );
    return result.ok ? result.value : result.error;
  }

  async recordQuarantine(source: SourceRef, record: QuarantineRecord): Promise<RecordOutcome> {
    return this.inSource(source, async () => {
      const receipt = await this.transactions.current().query(
        `insert into inbound_receipts
           (organization_id, source_id, message_fingerprint, outcome, reason, received_at)
         values ($1, $2, $3, 'quarantined', $4, $5)
         on conflict (organization_id, source_id, message_fingerprint) do nothing
         returning id`,
        [
          source.organizationId,
          source.sourceId,
          record.fingerprint,
          record.reason,
          record.receivedAt,
        ],
      );
      return receipt.rowCount === 1 ? 'recorded' : 'duplicate';
    });
  }

  private inSource<T>(source: SourceRef, work: () => Promise<T>): Promise<T> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      work,
    );
  }
}
