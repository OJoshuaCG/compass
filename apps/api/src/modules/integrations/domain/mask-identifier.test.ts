import { describe, expect, it } from 'vitest';

import { maskIdentifier } from './mask-identifier.js';

describe('maskIdentifier', () => {
  it('censura el correo del ejemplo del dueño conservando separadores y la terminación', () => {
    expect(maskIdentifier('admin.admin@correo.com')).toBe('a***.a***@c***.com');
  });

  it('censura un usuario sin arroba tramo por tramo', () => {
    expect(maskIdentifier('juan_perez-2')).toBe('j***_p***-2***');
  });

  it('no revela la longitud real del tramo', () => {
    expect(maskIdentifier('a')).toBe('a***');
    expect(maskIdentifier('abcdefghijkl')).toBe('a***');
  });

  it('conserva toda la terminación de un dominio compuesto solo en su último tramo', () => {
    expect(maskIdentifier('ana@mail.empresa.com.mx')).toBe('a***@m***.e***.c***.mx');
  });

  it('censura un dominio sin terminación sin inventar una', () => {
    expect(maskIdentifier('ana@localhost')).toBe('a***@l***');
  });

  it('devuelve vacío para una cadena vacía y no cambia una cadena solo de separadores', () => {
    expect(maskIdentifier('')).toBe('');
    expect(maskIdentifier('._-')).toBe('._-');
  });

  it('respeta alfabetos no latinos y caracteres fuera del plano básico', () => {
    expect(maskIdentifier('josé.ñandú@ejemplo.org')).toBe('j***.ñ***@e***.org');
    expect(maskIdentifier('𠮷野家')).toBe('𠮷***');
  });

  it('trata la arroba inicial como separador y no como correo', () => {
    expect(maskIdentifier('@usuario')).toBe('@u***');
  });

  it('nunca deja pasar el resto de un tramo largo, incluido un posible secreto pegado', () => {
    const masked: string = maskIdentifier('admin.Sup3rSecreta@correo.com');
    expect(masked).not.toContain('Sup3rSecreta');
    expect(masked).toBe('a***.S***@c***.com');
  });
});
