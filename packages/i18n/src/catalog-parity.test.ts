import { describe, expect, it } from 'vitest';

import {
  LOCALES,
  NAMESPACES,
  errorMessageKey,
  knownErrorKey,
  resolveLocale,
  resources,
} from './index.js';

/** Variables de interpolación `{{x}}` de un texto, ordenadas. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] ?? '').sort();
}

describe('i18n catalog parity', () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: every key exists in both locales`, () => {
      const [first, second] = LOCALES;
      const a = resources[first][ns] as Record<string, string>;
      const b = resources[second][ns] as Record<string, string>;
      const missingInSecond = Object.keys(a).filter((k) => !(k in b));
      const missingInFirst = Object.keys(b).filter((k) => !(k in a));
      expect({ missingInSecond, missingInFirst }).toEqual({
        missingInSecond: [],
        missingInFirst: [],
      });
    });

    it(`${ns}: interpolation variables match across locales`, () => {
      const [first, second] = LOCALES;
      const a = resources[first][ns] as Record<string, string>;
      const b = resources[second][ns] as Record<string, string>;
      for (const key of Object.keys(a)) {
        expect(placeholders(b[key] ?? ''), key).toEqual(placeholders(a[key] ?? ''));
      }
    });

    it(`${ns}: no value is empty`, () => {
      for (const locale of LOCALES) {
        const catalog = resources[locale][ns] as Record<string, string>;
        for (const [key, value] of Object.entries(catalog)) {
          expect(value.trim(), `${locale}/${ns}/${key}`).not.toBe('');
        }
      }
    });
  }
});

describe('i18n utilities', () => {
  it('derives the error key from the API code', () => {
    expect(errorMessageKey('AUTHZ.HIERARCHY.NOT_IN_SUBTREE')).toBe(
      'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
    );
    expect(knownErrorKey('AUTHZ.HIERARCHY.NOT_IN_SUBTREE')).toEqual({
      key: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
      known: true,
    });
  });

  it('falls back to the generic message for unknown codes', () => {
    expect(knownErrorKey('SOMETHING.NEW')).toEqual({ key: 'generic', known: false });
    expect(knownErrorKey('generic').known).toBe(false);
  });

  it('maps browser languages to supported locales', () => {
    expect(resolveLocale('en-GB')).toBe('en-US');
    expect(resolveLocale('es-AR')).toBe('es-MX');
    expect(resolveLocale('fr-FR')).toBe('es-MX');
    expect(resolveLocale(undefined)).toBe('es-MX');
    expect(resolveLocale('en-US')).toBe('en-US');
  });
});
