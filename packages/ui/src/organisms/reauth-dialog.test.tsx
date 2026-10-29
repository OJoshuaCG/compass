import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';

import { ReauthDialog, type ReauthDialogLabels } from './reauth-dialog';

const labels: ReauthDialogLabels = {
  title: 'Confirm identity',
  description: 'Enter your code',
  codeLabel: 'Authenticator code',
  submit: 'Confirm',
  cancel: 'Cancel',
  close: 'Close',
};

describe('ReauthDialog', () => {
  it('submits only a complete 6-digit code', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ReauthDialog open labels={labels} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const input = screen.getByLabelText(/Authenticator code/);
    expect(input).toHaveFocus();
    const submit = screen.getByRole('button', { name: 'Confirm' });
    expect(submit).toBeDisabled();
    await user.type(input, '123456');
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('offers a passkey only when the caller provides one', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    const { rerender } = render(
      <ReauthDialog open labels={labels} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).not.toBeInTheDocument();

    rerender(
      <ReauthDialog
        open
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        passkey={{ label: 'Use a passkey', onUse }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use a passkey' }));

    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('cancels with the button and with Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ReauthDialog open labels={labels} onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows the error and has no accessibility violations', async () => {
    render(
      <ReauthDialog
        open
        labels={labels}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        errorMessage="Invalid code"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid code');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
