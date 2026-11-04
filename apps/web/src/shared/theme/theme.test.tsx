import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createI18n } from '../i18n';

import { applyTheme, detectInitialTheme, readAppliedTheme } from './theme';
import { THEME_STORAGE_KEY } from './theme-storage';
import { ThemeSwitcher } from './theme-switcher';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('detectInitialTheme', () => {
  it('follows the system preference when nothing is stored, and does not store it', () => {
    expect(detectInitialTheme(true)).toBe('light');
    expect(detectInitialTheme(false)).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('prefers the stored choice over the system preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(detectInitialTheme(true)).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(detectInitialTheme(true)).toBe('light');
  });
});

describe('applyTheme / readAppliedTheme', () => {
  it('sets data-theme on the root element and reads it back', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(readAppliedTheme()).toBe('light');
  });

  it('reads dark when the bootstrap has not set a theme yet', () => {
    expect(readAppliedTheme()).toBe('dark');
  });
});

describe('ThemeSwitcher', () => {
  it('names the theme it switches to, applies it and remembers it', async () => {
    applyTheme('dark');
    render(
      <I18nextProvider i18n={createI18n('en-US')}>
        <ThemeSwitcher />
      </I18nextProvider>,
    );

    const toLight = screen.getByRole('button', { name: 'Switch to light theme' });
    await userEvent.click(toLight);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  });
});
