import { describe, expect, it } from 'vitest';

import { createLogger, isSensitiveKey } from './logger.js';

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

  describe('deep redaction by key words', () => {
    it.each([
      'newPassword',
      'currentPassword',
      'accessToken',
      'x-csrf-token',
      'set-cookie',
      'recoveryCodes',
      'emergency_codes',
      'totpSecret',
      'wrappedDek',
      'passwordHash',
      'APIToken',
      'CSRFToken',
      'SMSCode',
      'accesstoken',
      'cipherText',
      'passphrase',
      'x-api-key',
      'privateKey',
    ])('redacts the variant key "%s"', (key) => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.info({ [key]: 'variant-PLAIN', nested: { [key]: 'variant-PLAIN' } }, 'event');

      expect(sink.lines.join('')).not.toContain('variant-PLAIN');
    });

    it('redacts below depth 2, inside arrays and inside deep structures', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.info(
        {
          a: { b: { c: { d: { password: 'deep-PLAIN' } } } },
          items: [{ token: 'array-PLAIN' }, { inner: [{ secret: 'array-deep-PLAIN' }] }],
        },
        'event',
      );

      expect(sink.lines.join('')).not.toContain('PLAIN');
    });

    it('drops a subtree that is deeper than the limit instead of leaving it unchecked', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      let deepest: Record<string, unknown> = { leaf: 'too-deep-PLAIN' };
      for (let level = 0; level < 20; level += 1) deepest = { next: deepest };

      logger.info(deepest, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('too-deep-PLAIN');
      expect(output).toContain('[Truncated]');
    });

    it('survives circular references without throwing or leaking', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const circular: Record<string, unknown> = { password: 'circular-PLAIN' };
      circular['self'] = circular;

      const logCircularObject = (): void => {
        logger.info({ circular }, 'event');
      };

      expect(logCircularObject).not.toThrow();

      const output = sink.lines.join('');
      expect(output).not.toContain('circular-PLAIN');
      expect(output).toContain('[Circular]');
    });

    it('does not mutate the object it was given', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const original = { password: 'keep-PLAIN', nested: { token: 'keep-too-PLAIN' } };

      logger.info(original, 'event');

      expect(original.password).toBe('keep-PLAIN');
      expect(original.nested.token).toBe('keep-too-PLAIN');
    });

    it('still serializes errors and keeps ordinary fields readable', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.error({ err: new Error('boom'), requestId: 'req-7', statusDescription: 'ok' }, 'fail');

      const output = sink.lines.join('');
      expect(output).toContain('boom');
      expect(output).toContain('req-7');
      expect(output).toContain('ok');
    });

    it('does not treat unrelated words that merely contain a sensitive stem as sensitive', () => {
      expect(isSensitiveKey('organizationId')).toBe(false);
      expect(isSensitiveKey('requestId')).toBe(false);
      expect(isSensitiveKey('decode')).toBe(false);
      expect(isSensitiveKey('expiresAt')).toBe(false);
    });

    it('keeps diagnostic status codes readable', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.info({ statusCode: 503, errorCode: 'UPSTREAM' }, 'event');

      const output = sink.lines.join('');
      expect(output).toContain('503');
      expect(output).toContain('UPSTREAM');
    });

    it('never writes raw bytes, even under a neutral key', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.info(
        { key: Buffer.from('dek-bytes-PLAIN'), view: new Uint8Array([7, 7, 7]) },
        'event',
      );

      const output = sink.lines.join('');
      expect(output).not.toContain('"data"');
      expect(output).not.toContain('dek-bytes-PLAIN');
      expect(output).toContain('[Binary]');
    });

    it('redacts the properties of class instances nested below the fixed paths', () => {
      class LoginDto {
        readonly accessToken = 'dto-PLAIN';
        readonly email = 'user-1';
      }
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });

      logger.info({ a: { b: { c: { dto: new LoginDto() } } } }, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('dto-PLAIN');
      expect(output).toContain('user-1');
    });

    it('redacts the result of a custom toJSON', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const withToJson = {
        toJSON: () => ({ password: 'tojson-PLAIN', visible: 'shown' }),
      };

      logger.info({ wrapper: withToJson }, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('tojson-PLAIN');
      expect(output).toContain('shown');
    });

    it('redacts the bindings of child loggers', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink }).child({
        sessionToken: 'child-PLAIN',
        scope: { newPassword: 'child-nested-PLAIN' },
        component: 'vault',
      });

      logger.info('event');

      const output = sink.lines.join('');
      expect(output).not.toContain('PLAIN');
      expect(output).toContain('vault');
    });

    it('keeps redacting at the last allowed depth and truncates right after it', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      // El objeto de log está a profundidad 0 y cada propiedad suma un nivel: `atLimit` ya está a
      // 1, así que 7 envolturas dejan la hoja a 8 (la última permitida) y 8 la dejan a 9.
      let atLimit: Record<string, unknown> = { password: 'limit-PLAIN', marker: 'kept' };
      for (let level = 0; level < 7; level += 1) atLimit = { next: atLimit };

      let pastLimit: Record<string, unknown> = { leaf: 'past-PLAIN' };
      for (let level = 0; level < 8; level += 1) pastLimit = { next: pastLimit };

      logger.info({ atLimit, pastLimit }, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('limit-PLAIN');
      expect(output).toContain('kept');
      expect(output).not.toContain('past-PLAIN');
    });

    it('revisits a shared non-circular reference instead of marking it circular', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const shared = { label: 'shared-value', password: 'shared-PLAIN' };

      logger.info({ first: shared, second: shared }, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('shared-PLAIN');
      expect(output).not.toContain('[Circular]');
      expect(output.split('shared-value').length - 1).toBe(2);
    });

    it('does not throw when a getter fails and drops the whole object', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const hostile = {
        get boom(): string {
          throw new Error('getter exploded');
        },
      };

      const logHostileObject = (): void => {
        logger.info({ hostile }, 'event');
      };

      expect(logHostileObject).not.toThrow();
      expect(sink.lines.join('')).toContain('[Unserializable]');
    });

    it('keeps an own "__proto__" key as data instead of dropping the subtree', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const parsed = JSON.parse(
        '{"__proto__":{"password":"proto-PLAIN","note":"visible"}}',
      ) as unknown;

      logger.info({ parsed }, 'event');

      const output = sink.lines.join('');
      expect(output).not.toContain('proto-PLAIN');
      expect(output).toContain('visible');
    });

    it('caps very wide arrays instead of walking all of them', () => {
      const sink = capture();
      const logger = createLogger({ level: 'info', destination: sink });
      const wide = Array.from({ length: 5000 }, (_unused, index) => index);

      logger.info({ wide }, 'event');

      expect(sink.lines.join('')).toContain('[Truncated]');
    });
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
