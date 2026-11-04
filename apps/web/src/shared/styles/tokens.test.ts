import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Se lee el CSS real (no una copia): si alguien cambia un token, esta prueba lo mide.
const css = readFileSync(
  resolve(import.meta.dirname, '../../../../../packages/ui/src/styles/tokens.css'),
  'utf8',
);

type ThemeName = 'dark' | 'light';

// El tema oscuro es el valor por defecto de :root; el claro se activa con data-theme.
const THEME_BLOCKS: Record<ThemeName, RegExp> = {
  dark: /:root,\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/,
  light: /:root\[data-theme='light'\]\s*\{([^}]*)\}/,
};

function readTokens(source: string, theme: ThemeName): Record<string, string> {
  const block = THEME_BLOCKS[theme].exec(source)?.[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) tokens[name] = value;
  }
  return tokens;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa WCAG 2.x. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SURFACES = ['canvas', 'surface', 'raised'] as const;
const THEMES: readonly ThemeName[] = ['dark', 'light'];

const REQUIRED_TOKENS = [
  'canvas',
  'sidebar',
  'surface',
  'raised',
  'overlay',
  'text',
  'text-secondary',
  'text-muted',
  'text-disabled',
  'border',
  'border-strong',
  'border-input',
  'accent',
  'accent-solid',
  'accent-solid-hover',
  'on-accent',
  'success',
  'warning',
  'danger',
  'danger-solid',
  'on-danger',
  'info',
  'focus',
];

describe('design tokens', () => {
  it('declares both color schemes, the heading font in the base layer and the theme block', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).toMatch(/h1,[\s\S]*h4\s*\{[^}]*@apply font-heading/);
    expect(css).toMatch(/@theme inline/);
  });

  it('keeps glass as a utility for floating layers only', () => {
    expect(css).toMatch(/@utility glass\s*\{/);
    expect(css).toMatch(/@utility scrim\s*\{/);
  });

  describe.each(THEMES)('%s theme', (theme) => {
    const tokens = readTokens(css, theme);
    const token = (name: string): string => {
      const value = tokens[name];
      if (value === undefined) throw new Error(`Missing token --color-${name} in ${theme}`);
      return value;
    };

    it('reads every token of docs/frontend.md §4.1 as a 6-digit hex', () => {
      for (const name of REQUIRED_TOKENS) {
        expect(tokens, name).toHaveProperty(name);
      }
    });

    describe.each(SURFACES)('on %s', (surface) => {
      it.each([
        'text',
        'text-secondary',
        'text-muted',
        'accent',
        'success',
        'warning',
        'danger',
        'info',
        'focus',
      ])('text token %s reaches 4.5:1', (name) => {
        expect(contrast(token(name), token(surface))).toBeGreaterThanOrEqual(4.5);
      });

      it('border-input reaches 3:1 (WCAG 1.4.11)', () => {
        expect(contrast(token('border-input'), token(surface))).toBeGreaterThanOrEqual(3);
      });

      it('text-disabled stays at or above 3:1 (inactive controls only)', () => {
        expect(contrast(token('text-disabled'), token(surface))).toBeGreaterThanOrEqual(3);
      });
    });

    it('keeps primary text readable on the overlay surface used by dialogs and neutral chips', () => {
      expect(contrast(token('text'), token('overlay'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('text-secondary'), token('overlay'))).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps text readable on the sidebar surface', () => {
      expect(contrast(token('text'), token('sidebar'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('text-secondary'), token('sidebar'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('accent'), token('sidebar'))).toBeGreaterThanOrEqual(4.5);
    });

    it('solid buttons keep 4.5:1 for their label', () => {
      expect(contrast(token('on-accent'), token('accent-solid'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('on-accent'), token('accent-solid-hover'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('on-danger'), token('danger-solid'))).toBeGreaterThanOrEqual(4.5);
    });

    it('strong borders of tables and cards stay distinguishable from surfaces (decorative border excluded)', () => {
      expect(contrast(token('border-strong'), token('surface'))).toBeGreaterThan(1.5);
    });
  });

  it('computes WCAG ratios correctly (sanity: black on white = 21)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});
