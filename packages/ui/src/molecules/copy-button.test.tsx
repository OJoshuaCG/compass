import { act, render, screen, waitFor } from '@testing-library/react';
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
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Copied');
    });
  });

  it('announces a failure when the clipboard is rejected', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="ABC" label="Copy" copiedLabel="Copied" failedLabel="Failed" />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Failed');
    });
  });

  // El texto visible es aria-hidden (la región status ya lo anuncia): se localiza el que queda
  // fuera de ella.
  function visibleFeedback(text: string): HTMLElement | undefined {
    return screen
      .queryAllByText(text)
      .find((element) => element.closest('[role="status"]') === null);
  }

  it('shows visible text on success without ever painting the copied value', async () => {
    const user = userEvent.setup();
    render(
      <CopyButton value="SECRET-123" label="Copy" copiedLabel="Copied" failedLabel="Failed" />,
    );
    expect(visibleFeedback('Copied')).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(visibleFeedback('Copied')).toBeVisible();
    });
    expect(screen.queryByText('SECRET-123')).not.toBeInTheDocument();
  });

  it('shows visible text on failure', async () => {
    const user = userEvent.setup();
    render(<CopyButton value="ABC" label="Copy" copiedLabel="Copied" failedLabel="Failed" />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(visibleFeedback('Failed')).toBeVisible();
    });
    expect(visibleFeedback('Copied')).toBeUndefined();
  });

  it('hides the visible text when the state returns to idle', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <CopyButton
        value="ABC"
        label="Copy"
        copiedLabel="Copied"
        failedLabel="Failed"
        announceResetMs={5_000}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(visibleFeedback('Copied')).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(visibleFeedback('Copied')).toBeUndefined();
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

  it('does not overwrite the clipboard when it cannot be read', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValue(new Error('denied'));
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    write.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('returns to idle after a few seconds and announces every copy', async () => {
    // Margen amplio (60 s) para que una máquina lenta no pueda adelantar el reinicio entre los dos
    // clics; el paso a "idle" se comprueba avanzando el reloj falso, no esperando tiempo real.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <CopyButton
        value="ABC"
        label="Copy"
        copiedLabel="Copied"
        failedLabel="Failed"
        announceResetMs={60_000}
      />,
    );
    // La copia es asíncrona (promesa del portapapeles): se vacían las pendientes antes de aserciones.
    const flush = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    const first = screen.getByRole('status').textContent;
    expect(first).toContain('Copied');
    // Una segunda copia inmediata debe cambiar el contenido de la región para re-anunciarse.
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(screen.getByRole('status').textContent).toContain('Copied');
    expect(screen.getByRole('status').textContent).not.toBe(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_500);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
