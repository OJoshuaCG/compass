import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from './copy-button';

afterEach(() => {
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies the value and announces it in a status region', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="ABC" label="Copy" copiedLabel="Copied" failedLabel="Failed" />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('ABC');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('announces a failure when the clipboard is rejected', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="ABC" label="Copy" copiedLabel="Copied" failedLabel="Failed" />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Failed');
  });

  it('clears a copied secret from the clipboard after the delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <CopyButton
        value="SECRET"
        label="Copy"
        copiedLabel="Copied"
        failedLabel="Failed"
        clearAfterMs={30_000}
      />,
    );
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('SECRET');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    // El stub de user-event no admite leer un portapapeles vacío: se verifica la escritura.
    expect(write).toHaveBeenLastCalledWith('');
  });
});
