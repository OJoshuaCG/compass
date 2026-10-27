import { describe, expect, it, vi } from 'vitest';

import { navigateAfterAuth } from './return-navigation';

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
});
