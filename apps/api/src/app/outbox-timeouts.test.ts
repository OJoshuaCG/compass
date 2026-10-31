import { describe, expect, it } from 'vitest';

import { SMTP_WORST_CASE_ATTEMPT_MS } from '../modules/notification/index.js';
import { OUTBOX_HANDLER_TIMEOUT_MS, OUTBOX_STOP_TIMEOUT_MS } from '../modules/outbox/index.js';

/**
 * Relación entre los plazos del correo y del outbox. Si el correo pudiera tardar más que el plazo del
 * manejador, el trabajador revertiría un aviso ya aceptado por el servidor SMTP y lo reenviaría
 * (correo duplicado); si la parada no esperara más que el manejador, cortaría un envío a medias.
 */
describe('outbox and SMTP timeouts', () => {
  it('keeps the SMTP worst case below the handler deadline, and the handler deadline below the stop timeout', () => {
    expect(SMTP_WORST_CASE_ATTEMPT_MS).toBeLessThan(OUTBOX_HANDLER_TIMEOUT_MS);
    expect(OUTBOX_HANDLER_TIMEOUT_MS).toBeLessThan(OUTBOX_STOP_TIMEOUT_MS);
  });

  it('leaves the SMTP worst case at no more than half of the handler deadline', () => {
    // "Claramente por debajo": el resto del plazo cubre lecturas, el acuse y la variación de la red.
    expect(SMTP_WORST_CASE_ATTEMPT_MS * 2).toBeLessThanOrEqual(OUTBOX_HANDLER_TIMEOUT_MS);
  });
});
