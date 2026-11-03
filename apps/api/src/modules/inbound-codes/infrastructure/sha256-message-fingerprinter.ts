import { sha256Hex } from '../../crypto/index.js';
import type { MessageFingerprinter } from '../application/ports/inbound-recorder.js';

/**
 * Prefijos de dominio: una huella de bytes crudos nunca puede coincidir con la de una posición del buzón,
 * aunque el texto que se hashea llegara a parecerse.
 */
const RAW_MESSAGE_DOMAIN = 'raw-message';
const MAILBOX_POSITION_DOMAIN = 'mailbox-position';
const FIELD_SEPARATOR = '\n';

/**
 * Huellas con `sha256Hex` de la fachada de criptografía (este módulo no importa `node:crypto`). La fachada
 * recibe texto, así que los bytes se pasan como latin1: cada byte es un carácter distinto y la
 * correspondencia es inyectiva, es decir, dos mensajes distintos nunca producen el mismo texto de entrada.
 * La huella cabe en `^[!-~]{1,128}$` (64 caracteres hexadecimales).
 */
export class Sha256MessageFingerprinter implements MessageFingerprinter {
  forRawMessage(sourceId: string, rawMessage: Uint8Array): string {
    const bytesAsText = Buffer.from(rawMessage).toString('latin1');
    return sha256Hex([RAW_MESSAGE_DOMAIN, sourceId, bytesAsText].join(FIELD_SEPARATOR));
  }

  forMailboxPosition(sourceId: string, uidValidity: number, uid: number): string {
    return sha256Hex(
      [MAILBOX_POSITION_DOMAIN, sourceId, String(uidValidity), String(uid)].join(FIELD_SEPARATOR),
    );
  }
}
