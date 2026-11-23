import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PLATFORM_LOGO_PATHS } from './platform-logo-paths';
import { PlatformTile } from './platform-tile';

describe('PlatformTile', () => {
  it('draws the embedded logo of a known global platform, hidden from screen readers', () => {
    const { container } = render(<PlatformTile slug="instagram" fallback="Instagram" />);
    const tile = container.firstElementChild;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile?.querySelector('path')).toHaveAttribute('d', PLATFORM_LOGO_PATHS.instagram);
    expect(tile).not.toHaveTextContent('IN');
  });

  it('falls back to two letters without a slug or with an unknown one', () => {
    const { container: withoutSlug } = render(<PlatformTile fallback="Instagram" />);
    expect(withoutSlug.querySelector('svg')).toBeNull();
    expect(withoutSlug).toHaveTextContent('IN');

    const { container: unknown } = render(<PlatformTile slug="custom" fallback="Personalizada" />);
    expect(unknown.querySelector('svg')).toBeNull();
    expect(unknown).toHaveTextContent('PE');
  });

  it('covers every platform of the global catalog except the custom one', () => {
    // Migración 0005_vault: si se agrega una plataforma global, esta lista recuerda su logotipo.
    for (const slug of [
      'instagram',
      'facebook',
      'tiktok',
      'youtube',
      'x',
      'linkedin',
      'pinterest',
      'threads',
      'gmail',
      'outlook',
    ]) {
      expect(PLATFORM_LOGO_PATHS[slug], slug).toMatch(/^M/);
    }
  });
});
