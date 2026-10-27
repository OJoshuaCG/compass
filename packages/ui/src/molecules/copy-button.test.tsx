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
