import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('hides the value by default and toggles visibility with a pressed button', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="pw">Password</label>
        <PasswordInput id="pw" showLabel="Show" hideLabel="Hide" autoComplete="new-password" />
      </>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, 'secret');

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('secret');
  });
});
