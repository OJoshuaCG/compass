import { describe, expect, it } from 'vitest';

import { SigningKeyCommandError } from './signing-key-command-error.js';
import { parseSigningKeyArguments } from './signing-key-arguments.js';

const VALID_KID = 'q1w2e3r4t5y6u7i8o9p0as';

function expectUsageError(args: readonly string[]): void {
  expect(() => parseSigningKeyArguments(args)).toThrow(SigningKeyCommandError);
  try {
    parseSigningKeyArguments(args);
  } catch (error) {
    expect(error).toMatchObject({ code: 'USAGE' });
  }
}

describe('parseSigningKeyArguments', () => {
  it('list', () => {
    expect(parseSigningKeyArguments(['list'])).toEqual({ action: 'list' });
  });

  it('rotate sin algoritmo deja que el servicio use el suyo por defecto', () => {
    expect(parseSigningKeyArguments(['rotate'])).toEqual({
      action: 'rotate',
      algorithm: undefined,
    });
  });

  it.each(['ES256', 'RS256'] as const)('rotate con %s', (algorithm) => {
    expect(parseSigningKeyArguments(['rotate', algorithm])).toEqual({
      action: 'rotate',
      algorithm,
    });
  });

  it('retire con un kid', () => {
    expect(parseSigningKeyArguments(['retire', VALID_KID])).toEqual({
      action: 'retire',
      kid: VALID_KID,
    });
  });

  it.each([
    ['sin argumentos', []],
    ['acción desconocida', ['delete']],
    ['algoritmo no admitido', ['rotate', 'HS256']],
    ['algoritmo en minúsculas', ['rotate', 'es256']],
    ['retire sin kid', ['retire']],
    ['kid con caracteres fuera de base64url', ['retire', 'abc def']],
    ['kid vacío', ['retire', '']],
    ['kid demasiado largo', ['retire', 'a'.repeat(65)]],
    ['argumento sobrante en list', ['list', 'extra']],
    ['argumento sobrante en rotate', ['rotate', 'ES256', 'extra']],
    ['argumento sobrante en retire', ['retire', VALID_KID, 'extra']],
  ] as const)('rechaza %s con un error de uso', (_description, args) => {
    expectUsageError(args);
  });
});
