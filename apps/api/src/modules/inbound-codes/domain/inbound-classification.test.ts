import { describe, expect, it } from 'vitest';

import { buildLoginCodeTemplate, buildResetLinkTemplate } from '../testing/mail-fixtures.js';
import { classifyMatchedTemplates, classifyTemplate } from './inbound-classification.js';
import type { InboundTemplate } from './inbound-template.js';

// SENSIBLE (revisión humana)
describe('fail-closed classification', () => {
  it('makes visible only an explicit login_code template with code extraction', () => {
    expect(classifyTemplate(buildLoginCodeTemplate())).toBe('visible_with_use');
  });

  it('treats reset_code and reset_link templates as sensitive', () => {
    expect(classifyTemplate(buildLoginCodeTemplate({ kind: 'reset_code' }))).toBe('sensitive');
    expect(classifyTemplate(buildResetLinkTemplate())).toBe('sensitive');
  });

  it('treats an unknown kind as sensitive (default is sensitive, never login_code)', () => {
    const unknownKind = buildLoginCodeTemplate({
      kind: 'cualquier_cosa' as unknown as 'login_code',
    });
    expect(classifyTemplate(unknownKind)).toBe('sensitive');
  });

  it('treats a link as sensitive even when the template claims login_code', () => {
    expect(classifyTemplate(buildResetLinkTemplate({ kind: 'login_code' }))).toBe('sensitive');
  });

  it('is sensitive when nothing matched: no template means nothing is visible', () => {
    expect(classifyMatchedTemplates([])).toBe('sensitive');
  });

  it('is visible only when every matched template is an explicit login_code template', () => {
    const loginCode = buildLoginCodeTemplate();
    const otherLoginCode = buildLoginCodeTemplate({ id: 'otra' });
    const resetCode = buildLoginCodeTemplate({ id: 'reset', kind: 'reset_code' });
    const matchedSets: [readonly InboundTemplate[], string][] = [
      [[loginCode, otherLoginCode], 'visible_with_use'],
      [[loginCode, resetCode], 'sensitive'],
      [[resetCode, loginCode], 'sensitive'],
      [[resetCode], 'sensitive'],
    ];

    for (const [matched, expected] of matchedSets) {
      expect(classifyMatchedTemplates(matched)).toBe(expected);
    }
  });
});
