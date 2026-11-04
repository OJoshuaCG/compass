import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

import { LOCALE_STORAGE_KEY } from './locale-storage';

const switchToEnglish = es.common['language.switchTo'].replace(
  '{{language}}',
  es.common['language.en-US'],
);

describe('language switcher', () => {
  it('shows the code of the active language and names the language it switches to', async () => {
    stubApi({ 'GET /me': problem(401, 'AUTHZ.SESSION') });
    renderApp('/login');
    const toggle = await screen.findByRole('button', { name: switchToEnglish });
    expect(toggle).toHaveTextContent('ES');
    expect(screen.getByText('ES')).toHaveAttribute('lang', 'es-MX');
  });

  it('toggles between the languages, updates <html lang> and remembers the choice', async () => {
    const user = userEvent.setup();
    stubApi({ 'GET /me': jsonResponse(meFixture()) });
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: switchToEnglish }));
    const backToSpanish = await screen.findByRole('button', {
      name: 'Switch to Español (México)',
    });
    expect(backToSpanish).toHaveTextContent('EN');
    expect(document.documentElement.lang).toBe('en-US');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
    await user.click(backToSpanish);
    expect(await screen.findByRole('button', { name: switchToEnglish })).toHaveTextContent('ES');
    expect(document.documentElement.lang).toBe('es-MX');
  });
});
