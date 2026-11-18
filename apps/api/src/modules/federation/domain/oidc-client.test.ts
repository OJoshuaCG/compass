import { describe, expect, it } from 'vitest';

import {
  isClientRank,
  normalizeClientName,
  normalizeRedirectUri,
  normalizeRefreshJustification,
  normalizeUriList,
} from './oidc-client.js';

describe('normalizeRedirectUri', () => {
  it.each([
    'https://grafana.example.com/login/generic_oauth',
    'http://localhost:3000/callback',
    'http://127.0.0.1:8080/cb',
    'http://[::1]:8080/cb',
  ])('acepta %s', (uri) => {
    expect(normalizeRedirectUri(uri)).toBe(uri);
  });

  it.each([
    ['http fuera de bucle local', 'http://grafana.example.com/cb'],
    ['comodín', 'https://*.example.com/cb'],
    ['fragmento', 'https://app.example.com/cb#x'],
    ['fragmento vacío', 'https://app.example.com/cb#'],
    ['credenciales', 'https://user:pass@app.example.com/cb'],
    ['esquema peligroso', 'javascript:alert(1)'],
    ['esquema personalizado', 'myapp://cb'],
    ['no es una URL', 'no-url'],
    ['vacía', ''],
  ])('rechaza %s', (_label, uri) => {
    expect(normalizeRedirectUri(uri)).toBeNull();
  });

  it('rechaza una URI de más de 2048 caracteres', () => {
    expect(normalizeRedirectUri(`https://a.example.com/${'x'.repeat(2048)}`)).toBeNull();
  });
});

describe('normalizeUriList', () => {
  it('quita duplicados y conserva el orden', () => {
    expect(normalizeUriList(['https://a.example.com/x', 'https://a.example.com/x'])).toEqual([
      'https://a.example.com/x',
    ]);
  });

  it('rechaza más de 10 y cualquier elemento inválido', () => {
    const many = Array.from(
      { length: 11 },
      (_, index) => `https://a${String(index)}.example.com/x`,
    );
    expect(normalizeUriList(many)).toBeNull();
    expect(normalizeUriList(['https://a.example.com/x', 'http://b.example.com/x'])).toBeNull();
  });
});

describe('validadores simples', () => {
  it('nombre: recorta y limita a 80', () => {
    expect(normalizeClientName('  Grafana ')).toBe('Grafana');
    expect(normalizeClientName('   ')).toBeNull();
    expect(normalizeClientName('x'.repeat(81))).toBeNull();
  });

  it('justificación del refresh: entre 10 y 500', () => {
    expect(normalizeRefreshJustification('corta')).toBeNull();
    expect(normalizeRefreshJustification('Sesiones largas de la consola')).not.toBeNull();
    expect(normalizeRefreshJustification('x'.repeat(501))).toBeNull();
  });

  it('rango: solo 0 a 3', () => {
    expect([0, 1, 2, 3].every(isClientRank)).toBe(true);
    expect([4, -1, 1.5, '1', null].some(isClientRank)).toBe(false);
  });
});
