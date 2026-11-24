import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateAfterAuth } from './return-navigation';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navigateAfterAuth', () => {
  it('falls back to home when pushing the return path throws', () => {
    const navigate = vi.fn();
    const push = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => {
      navigateAfterAuth({ navigate, history: { push } }, '/users');
    }).not.toThrow();
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('pushes a valid return path', () => {
    const navigate = vi.fn();
    const push = vi.fn();
    navigateAfterAuth({ navigate, history: { push } }, '/users');
    expect(push).toHaveBeenCalledWith('/users');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates the full page for a provider path instead of pushing it to the SPA history', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const navigate = vi.fn();
    const push = vi.fn();
    navigateAfterAuth({ navigate, history: { push } }, '/oidc/interaction/abc123');
    expect(assign).toHaveBeenCalledWith('/oidc/interaction/abc123');
    expect(push).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not treat a path that only resembles the provider prefix as a provider path', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const push = vi.fn();
    navigateAfterAuth({ navigate: vi.fn(), history: { push } }, '/oidcish/page');
    expect(push).toHaveBeenCalledWith('/oidcish/page');
    expect(assign).not.toHaveBeenCalled();
  });
});
