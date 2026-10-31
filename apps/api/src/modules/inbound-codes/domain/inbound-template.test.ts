import { describe, expect, it } from 'vitest';

import {
  FIXTURE_SENDER,
  buildLoginCodeTemplate,
  buildResetLinkTemplate,
} from '../testing/mail-fixtures.js';
import {
  findTemplateProblems,
  isTemplateEvaluable,
  templateMatchesEnvelope,
} from './inbound-template.js';
import type { FixedLengthCodeRule, InboundTemplate } from './inbound-template.js';

const OVERSIZED_LENGTH = 1_000_000;

function withCodeRule(overrides: Partial<FixedLengthCodeRule>): InboundTemplate {
  const base = buildLoginCodeTemplate();
  if (base.extraction.type !== 'fixed_length_code') throw new Error('fixture must be a code rule');
  return { ...base, extraction: { ...base.extraction, ...overrides } };
}

// SENSIBLE (revisión humana)
describe('inbound template matching', () => {
  const template = buildLoginCodeTemplate();

  it('matches the exact sender with an equal subject', () => {
    expect(templateMatchesEnvelope(template, FIXTURE_SENDER, 'Tu código de acceso')).toBe(true);
  });

  it('does not match a sender that contains the exact one as prefix or suffix', () => {
    const subject = 'Tu código de acceso';
    expect(templateMatchesEnvelope(template, `x${FIXTURE_SENDER}`, subject)).toBe(false);
    expect(templateMatchesEnvelope(template, `${FIXTURE_SENDER}.evil.example`, subject)).toBe(
      false,
    );
    expect(templateMatchesEnvelope(template, 'security@facebook.com.evil.example', subject)).toBe(
      false,
    );
  });

  it('does not match a sender with confusable Unicode, whatever the template says', () => {
    const confusableTemplate = buildLoginCodeTemplate({ senderAddress: 'security@fаcebook.com' });
    expect(
      templateMatchesEnvelope(confusableTemplate, 'security@fаcebook.com', 'Tu código de acceso'),
    ).toBe(false);
    expect(templateMatchesEnvelope(template, 'security@fаcebook.com', 'Tu código de acceso')).toBe(
      false,
    );
  });

  it('uses equality for equals subjects and prefix for prefix subjects', () => {
    const prefixTemplate = buildLoginCodeTemplate({
      subject: { mode: 'prefix', value: 'Tu código' },
    });

    expect(templateMatchesEnvelope(template, FIXTURE_SENDER, 'Tu código de acceso ahora')).toBe(
      false,
    );
    expect(templateMatchesEnvelope(template, FIXTURE_SENDER, 'tu código de acceso')).toBe(false);
    expect(
      templateMatchesEnvelope(prefixTemplate, FIXTURE_SENDER, 'Tu código de acceso ahora'),
    ).toBe(true);
    expect(templateMatchesEnvelope(prefixTemplate, FIXTURE_SENDER, 'Re: Tu código')).toBe(false);
  });

  it('does not interpret the subject rule as a regular expression', () => {
    const regexLike = buildLoginCodeTemplate({ subject: { mode: 'prefix', value: '.*' } });

    expect(templateMatchesEnvelope(regexLike, FIXTURE_SENDER, 'cualquier asunto')).toBe(false);
    expect(templateMatchesEnvelope(regexLike, FIXTURE_SENDER, '.* literal')).toBe(true);
  });

  it('fails closed on a missing or oversized subject when a subject rule exists', () => {
    expect(templateMatchesEnvelope(template, FIXTURE_SENDER, null)).toBe(false);
    const hugeSubject = 'Tu código de acceso'.padEnd(OVERSIZED_LENGTH, 'x');
    const prefixTemplate = buildLoginCodeTemplate({ subject: { mode: 'prefix', value: 'Tu' } });
    expect(templateMatchesEnvelope(prefixTemplate, FIXTURE_SENDER, hugeSubject)).toBe(false);
  });

  it('ignores the subject when the template has no subject rule', () => {
    const anySubject = buildLoginCodeTemplate({ subject: null });
    expect(templateMatchesEnvelope(anySubject, FIXTURE_SENDER, null)).toBe(true);
  });
});

describe('inbound template validation', () => {
  it('accepts well formed templates', () => {
    expect(findTemplateProblems(buildLoginCodeTemplate())).toEqual([]);
    expect(findTemplateProblems(buildResetLinkTemplate())).toEqual([]);
  });

  it('reports an invalid sender and empty or oversized literals', () => {
    expect(findTemplateProblems(buildLoginCodeTemplate({ senderAddress: 'no-address' }))).toContain(
      'INVALID_SENDER',
    );
    expect(findTemplateProblems(withCodeRule({ leadingLiteral: '' }))).toContain(
      'INVALID_LEADING_LITERAL',
    );
    expect(
      findTemplateProblems(withCodeRule({ leadingLiteral: 'x'.repeat(OVERSIZED_LENGTH) })),
    ).toContain('INVALID_LEADING_LITERAL');
    expect(
      findTemplateProblems(withCodeRule({ trailingLiteral: 'x'.repeat(OVERSIZED_LENGTH) })),
    ).toContain('INVALID_TRAILING_LITERAL');
    expect(
      findTemplateProblems(buildLoginCodeTemplate({ subject: { mode: 'equals', value: '' } })),
    ).toContain('INVALID_SUBJECT_RULE');
    expect(
      findTemplateProblems(
        buildLoginCodeTemplate({
          subject: { mode: 'prefix', value: 'x'.repeat(OVERSIZED_LENGTH) },
        }),
      ),
    ).toContain('INVALID_SUBJECT_RULE');
  });

  it('reports out-of-range code lengths and unknown charsets', () => {
    for (const codeLength of [0, 3, 13, 6.5, Number.NaN]) {
      expect(findTemplateProblems(withCodeRule({ codeLength }))).toContain('INVALID_CODE_LENGTH');
    }
    const unknownCharset = withCodeRule({ charset: 'regex' as unknown as 'digits' });
    expect(findTemplateProblems(unknownCharset)).toContain('UNKNOWN_CHARSET');
  });

  it('reports invalid link hosts: wildcards, ports, paths, uppercase, empty and too many', () => {
    const invalidHostLists = [
      [],
      ['*.facebook.com'],
      ['www.facebook.com:443'],
      ['www.facebook.com/recover'],
      ['WWW.facebook.com'],
      ['user@www.facebook.com'],
      ['www.facebook.com.'],
      Array.from({ length: 9 }, (_, index) => `h${String(index)}.example.test`),
    ];
    for (const allowedHosts of invalidHostLists) {
      const template = buildResetLinkTemplate({
        extraction: { type: 'allowed_host_link', allowedHosts, pathPrefix: '/recover' },
      });
      expect(findTemplateProblems(template)).toContain('INVALID_ALLOWED_HOSTS');
    }
  });

  it('reports an invalid path prefix', () => {
    for (const pathPrefix of ['recover', '', `/${'x'.repeat(OVERSIZED_LENGTH)}`]) {
      const template = buildResetLinkTemplate({
        extraction: { type: 'allowed_host_link', allowedHosts: ['www.facebook.com'], pathPrefix },
      });
      expect(findTemplateProblems(template)).toContain('INVALID_PATH_PREFIX');
    }
  });

  it('reports an unknown kind and a kind that does not fit its extraction', () => {
    const unknownKind = buildLoginCodeTemplate({
      kind: 'admin_everything' as unknown as 'login_code',
    });
    const linkAsLoginCode = buildResetLinkTemplate({ kind: 'login_code' });
    const codeAsResetLink = buildLoginCodeTemplate({ kind: 'reset_link' });

    expect(findTemplateProblems(unknownKind)).toContain('UNKNOWN_KIND');
    expect(findTemplateProblems(linkAsLoginCode)).toContain('KIND_EXTRACTION_MISMATCH');
    expect(findTemplateProblems(codeAsResetLink)).toContain('KIND_EXTRACTION_MISMATCH');
  });

  it('does not evaluate templates with structural problems (huge pattern) but does evaluate classification-only problems', () => {
    const hugePattern = withCodeRule({ leadingLiteral: 'x'.repeat(OVERSIZED_LENGTH) });
    const unknownKind = buildLoginCodeTemplate({
      kind: 'admin_everything' as unknown as 'login_code',
    });
    const linkAsLoginCode = buildResetLinkTemplate({ kind: 'login_code' });

    expect(isTemplateEvaluable(hugePattern)).toBe(false);
    expect(isTemplateEvaluable(unknownKind)).toBe(true);
    expect(isTemplateEvaluable(linkAsLoginCode)).toBe(true);
  });
});
