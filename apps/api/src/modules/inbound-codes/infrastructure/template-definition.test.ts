import { describe, expect, it } from 'vitest';

import { parseTemplateRow } from './template-definition.js';

const CODE_DEFINITION = {
  senderAddress: 'no-reply@vendor.example',
  subject: { mode: 'prefix', value: 'Tu código' },
  extraction: {
    type: 'fixed_length_code',
    leadingLiteral: 'Código: ',
    codeLength: 6,
    charset: 'digits',
    trailingLiteral: '',
  },
};

const LINK_DEFINITION = {
  senderAddress: 'no-reply@vendor.example',
  subject: null,
  extraction: {
    type: 'allowed_host_link',
    allowedHosts: ['accounts.vendor.example'],
    pathPrefix: '/reset',
  },
};

const row = (kind: string, definition: unknown) => ({ id: 'template-1', kind, definition });

describe('parseTemplateRow', () => {
  it('builds a code template and a link template from their stored definition', () => {
    expect(parseTemplateRow(row('login_code', CODE_DEFINITION))).toEqual({
      id: 'template-1',
      kind: 'login_code',
      ...CODE_DEFINITION,
    });
    expect(parseTemplateRow(row('reset_link', LINK_DEFINITION))).toEqual({
      id: 'template-1',
      kind: 'reset_link',
      ...LINK_DEFINITION,
    });
  });

  it.each([
    ['an unknown kind', row('other_kind', CODE_DEFINITION)],
    ['a definition that is not an object', row('login_code', 'texto')],
    ['a null definition', row('login_code', null)],
    ['an array definition', row('login_code', [])],
    ['a missing sender', row('login_code', { ...CODE_DEFINITION, senderAddress: undefined })],
    ['a non-text sender', row('login_code', { ...CODE_DEFINITION, senderAddress: 5 })],
    ['an unreadable subject rule', row('login_code', { ...CODE_DEFINITION, subject: 'x' })],
    [
      'a subject mode outside the allowed ones',
      row('login_code', { ...CODE_DEFINITION, subject: { mode: 'regex', value: '.*' } }),
    ],
    ['a missing extraction', row('login_code', { ...CODE_DEFINITION, extraction: undefined })],
    [
      'an unknown extraction type',
      row('login_code', { ...CODE_DEFINITION, extraction: { type: 'regex', pattern: '.*' } }),
    ],
    [
      'a code length that is not a number',
      row('login_code', {
        ...CODE_DEFINITION,
        extraction: { ...CODE_DEFINITION.extraction, codeLength: '6' },
      }),
    ],
    [
      'a charset outside the allowed ones',
      row('login_code', {
        ...CODE_DEFINITION,
        extraction: { ...CODE_DEFINITION.extraction, charset: 'any' },
      }),
    ],
    [
      'allowed hosts that are not all text',
      row('reset_link', {
        ...LINK_DEFINITION,
        extraction: { ...LINK_DEFINITION.extraction, allowedHosts: ['a.example', 7] },
      }),
    ],
  ])('discards %s', (_label, input) => {
    expect(parseTemplateRow(input)).toBeNull();
  });

  it('discards a readable definition that the domain cannot evaluate', () => {
    const emptyLeadingLiteral = {
      ...CODE_DEFINITION,
      extraction: { ...CODE_DEFINITION.extraction, leadingLiteral: '' },
    };

    expect(parseTemplateRow(row('login_code', emptyLeadingLiteral))).toBeNull();
  });

  it('keeps a code extraction attached to a link kind: the domain classifies it as sensitive', () => {
    // Descartarla dejaría que otra plantilla del mismo mensaje hiciera visible lo que esta ocultaba.
    expect(parseTemplateRow(row('reset_link', CODE_DEFINITION))).not.toBeNull();
  });
});
