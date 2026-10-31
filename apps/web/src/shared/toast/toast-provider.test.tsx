import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '../i18n/setup';

import { ToastProvider, useToast } from './toast-provider';

// Mismo valor que DISMISS_AFTER_MS del proveedor: la prueba fija el contrato de los 6 s.
const AUTO_DISMISS_MS = 6000;
const MESSAGE = 'Saved';

function ShowToastButton() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show(MESSAGE, 'success');
      }}
    >
      show
    </button>
  );
}

function renderProvider() {
  render(
    <I18nextProvider i18n={createI18n('en-US')}>
      <ToastProvider>
        <ShowToastButton />
      </ToastProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
}

const toastMessage = () => screen.queryByText(MESSAGE);
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('ToastProvider auto dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses the toast after 6 seconds when nobody interacts with it', () => {
    renderProvider();
    advance(AUTO_DISMISS_MS - 1);
    expect(toastMessage()).toBeInTheDocument();
    advance(1);
    expect(toastMessage()).not.toBeInTheDocument();
  });

  it('pauses while the pointer is over the toast and resumes with the remaining time', () => {
    renderProvider();
    const card = screen.getByText(MESSAGE).parentElement as HTMLElement;
    advance(4000);
    fireEvent.pointerEnter(card);
    advance(AUTO_DISMISS_MS * 2);
    expect(toastMessage()).toBeInTheDocument();

    fireEvent.pointerLeave(card);
    advance(1999);
    expect(toastMessage()).toBeInTheDocument();
    advance(1);
    expect(toastMessage()).not.toBeInTheDocument();
  });

  it('pauses while focus is inside the toast and resumes when it leaves', () => {
    renderProvider();
    const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
    advance(3000);
    act(() => {
      dismissButton.focus();
    });
    advance(AUTO_DISMISS_MS * 2);
    expect(toastMessage()).toBeInTheDocument();

    act(() => {
      dismissButton.blur();
    });
    advance(3000);
    expect(toastMessage()).not.toBeInTheDocument();
  });

  it('stays paused while the pointer leaves but the focus is still inside', () => {
    renderProvider();
    const card = screen.getByText(MESSAGE).parentElement as HTMLElement;
    const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.pointerEnter(card);
    act(() => {
      dismissButton.focus();
    });
    fireEvent.pointerLeave(card);
    advance(AUTO_DISMISS_MS * 2);
    expect(toastMessage()).toBeInTheDocument();

    act(() => {
      dismissButton.blur();
    });
    advance(AUTO_DISMISS_MS);
    expect(toastMessage()).not.toBeInTheDocument();
  });
});
