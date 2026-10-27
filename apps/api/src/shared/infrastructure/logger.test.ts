import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe('logger redaction', () => {
  const secrets = {
    password: 'hunter2-PLAIN',
    secret: 'totp-SEED-PLAIN',
    token: 'tok-PLAIN',
    totp: '123456-PLAIN',
    code: '654321-PLAIN',
    authorization: 'Bearer abc-PLAIN',
    cookie: '__Host-session=PLAIN',
    ciphertext: 'ct-PLAIN',
    wrapped_dek: 'dek-PLAIN',
  };

  it.each(Object.keys(secrets))('redacts "%s" at depth 0, 1 and 2', (key) => {
    const sink = capture();
    const logger = createLogger({ level: 'info', destination: sink });
    const value = secrets[key as keyof typeof secrets];

    logger.info({ [key]: value, a: { [key]: value }, b: { c: { [key]: value } } }, 'event');

    const output = sink.lines.join('');
    expect(output).not.toContain(value);
    expect(output).toContain('[Redacted]');
  });

  it('never logs the request body or credential headers', () => {
    const sink = capture();
    const logger = createLogger({ level: 'info', destination: sink });

    logger.info(
      {
        req: {
          body: { password: 'body-PLAIN' },
          headers: { authorization: 'Bearer x-PLAIN', cookie: 'sid-PLAIN', accept: 'text/html' },
        },
      },
      'request',
    );

    const output = sink.lines.join('');
    expect(output).not.toContain('PLAIN');
    expect(output).toContain('text/html');
  });

  it('keeps non-sensitive fields intact', () => {
    const sink = capture();
    createLogger({ level: 'info', destination: sink }).info(
      { requestId: 'req-1', organizationId: 'org-1' },
      'ok',
    );

    expect(sink.lines.join('')).toContain('req-1');
  });
});
