import { ERROR_CODES } from '@iam/contracts';
import { LOCALES, resources } from '@iam/i18n';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NETWORK_ERROR_CODE } from '../api';

import { createI18n } from './setup';
import { useErrorMessage } from './use-error-message';

function setup(locale: 'es-MX' | 'en-US') {
  const i18n = createI18n(locale);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  );
  return renderHook(() => useErrorMessage(), { wrapper }).result.current;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API error codes in the i18n catalog', () => {
  it.each(LOCALES)('%s translates every code of @iam/contracts', (locale) => {
    const catalog = resources[locale].errors as Record<string, string>;
    expect(ERROR_CODES.filter((code) => !(code in catalog))).toEqual([]);
  });
});

describe('useErrorMessage', () => {
  const hierarchy = (requestId?: string) =>
    new ApiError({ status: 403, code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE', title: 'x', requestId });

  it('translates the code per locale', () => {
    expect(setup('es-MX')(hierarchy())).toBe(
      resources['es-MX'].errors['AUTHZ.HIERARCHY.NOT_IN_SUBTREE'],
    );
    expect(setup('en-US')(hierarchy())).toBe(
      resources['en-US'].errors['AUTHZ.HIERARCHY.NOT_IN_SUBTREE'],
    );
  });

  it('appends the request id for support when present', () => {
    expect(setup('en-US')(hierarchy('REQ1'))).toContain('Request ID: REQ1');
  });

  it('uses the generic message and logs the code when it is unknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const message = setup('en-US')(
      new ApiError({ status: 400, code: 'SOMETHING.NEW', title: 'x' }),
    );
    expect(message).toBe(resources['en-US'].errors.generic);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SOMETHING.NEW'));
  });

  it('has a dedicated message for network failures and a generic one for unknown errors', () => {
    const translate = setup('en-US');
    expect(translate(new ApiError({ status: 0, code: NETWORK_ERROR_CODE, title: 'x' }))).toBe(
      resources['en-US'].errors.network,
    );
    expect(translate(new Error('boom'))).toBe(resources['en-US'].errors.generic);
  });
});
