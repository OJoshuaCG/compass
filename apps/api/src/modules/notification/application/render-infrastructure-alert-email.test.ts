import { describe, expect, it } from 'vitest';

import type { InfrastructureAlertMessage } from './ports/mailer.js';
import { renderInfrastructureAlertEmail } from './render-infrastructure-alert-email.js';

const BASE_MESSAGE: InfrastructureAlertMessage = {
  to: 'root@x.test',
  locale: 'es-MX',
  code: 'job_failed',
  occurredAt: new Date('2026-11-04T03:23:00.000Z'),
};

describe('renderInfrastructureAlertEmail', () => {
  it('describe la falla y la hora en ambos idiomas', () => {
    const spanish = renderInfrastructureAlertEmail(BASE_MESSAGE);
    const english = renderInfrastructureAlertEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(spanish.subject).toBe('Alerta de infraestructura de Compass');
    expect(spanish.text).toContain('Una tarea programada de la plataforma falló');
    expect(spanish.text).toContain('UTC');
    expect(english.subject).toBe('Compass infrastructure alert');
    expect(english.text).toContain('A scheduled platform job failed');
  });

  it.each(['service_unhealthy', 'job_failed', 'events_quarantined'] as const)(
    'tiene texto propio para el código %s',
    (code) => {
      const spanish = renderInfrastructureAlertEmail({ ...BASE_MESSAGE, code });
      const english = renderInfrastructureAlertEmail({ ...BASE_MESSAGE, code, locale: 'en-US' });

      expect(spanish.text.split('\n')[0]).not.toBe('');
      expect(english.text.split('\n')[0]).not.toBe('');
      expect(spanish.text).not.toBe(english.text);
    },
  );

  it('no lleva enlaces ni el destinatario', () => {
    const email = renderInfrastructureAlertEmail(BASE_MESSAGE);

    expect(email.html).not.toContain('href');
    expect(email.text).not.toContain('http');
    expect(email.text).not.toContain(BASE_MESSAGE.to);
    expect(email.html).not.toContain(BASE_MESSAGE.to);
  });
});
