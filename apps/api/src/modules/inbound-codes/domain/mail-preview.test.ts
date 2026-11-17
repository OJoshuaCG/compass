import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import { MAIL_PREVIEW_FIELD, mailPreviewContext, sanitizePreviewText } from './mail-preview.js';

describe('sanitizePreviewText', () => {
  it('pone el asunto en una sola línea y quita controles y marcas de dirección', () => {
    expect(sanitizePreviewText('  Hola\r\nmundo\u202e\u2066\u200f\u0007  ', 'subject')).toBe(
      'Hola  mundo',
    );
  });

  it('conserva los saltos de línea y los tabuladores del cuerpo y quita lo demás', () => {
    expect(sanitizePreviewText('Línea 1\r\nLínea\t2\u0000\u009f\u202d', 'body')).toBe(
      'Línea 1\r\nLínea\t2',
    );
  });

  it('quita los caracteres invisibles que disfrazan un asunto', () => {
    expect(sanitizePreviewText('C\u200bó\u200cd\u200di\u2060g\ufeffo\u{e0041}', 'subject')).toBe(
      'Código',
    );
  });

  it('trata los separadores de línea de Unicode como un salto: espacio en el asunto, salto en el cuerpo', () => {
    expect(sanitizePreviewText('Uno\u2028Dos\u2029Tres', 'subject')).toBe('Uno Dos Tres');
    expect(sanitizePreviewText('Uno\u2028Dos', 'body')).toBe('Uno\nDos');
  });

  it('no interpreta HTML ni enlaces: los deja como texto', () => {
    const raw = '<a href="https://example.test">clic</a>';
    expect(sanitizePreviewText(raw, 'body')).toBe(raw);
  });
});

describe('mailPreviewContext', () => {
  const organizationId = asOrganizationId('0198dddd-0000-7000-8000-000000000001');

  it('usa un campo propio y el id de la petición en el contexto de cifrado', () => {
    expect(mailPreviewContext(organizationId, 'req-1')).toEqual({
      organizationId,
      resourceId: 'req-1',
      field: MAIL_PREVIEW_FIELD,
      version: 1,
    });
    expect(MAIL_PREVIEW_FIELD).toBe('mail_preview');
  });
});
