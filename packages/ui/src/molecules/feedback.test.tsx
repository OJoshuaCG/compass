import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';

import { Alert } from './alert';
import { Dialog } from './dialog';
import { StrengthMeter } from './strength-meter';
import { ToastViewport } from './toast';

describe('Alert', () => {
  it('announces its content with role alert', () => {
    render(<Alert tone="danger">Something failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });
});

describe('StrengthMeter', () => {
  it('exposes value and text to assistive technology', () => {
    render(<StrengthMeter level={3} label="Strength" levelText="Good" />);
    const meter = screen.getByRole('meter', { name: 'Strength' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuetext', 'Good');
  });
});

describe('ToastViewport', () => {
  it('keeps a persistent live region and dismisses on click', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ToastViewport
        toasts={[]}
        onDismiss={onDismiss}
        dismissLabel="Dismiss"
        regionLabel="Notices"
      />,
    );
    expect(screen.getByRole('status', { name: 'Notices' })).toBeInTheDocument();
    rerender(
      <ToastViewport
        toasts={[{ id: 'a', message: 'Saved', tone: 'success' }]}
        onDismiss={onDismiss}
        dismissLabel="Dismiss"
        regionLabel="Notices"
      />,
    );
    expect(screen.getByRole('status', { name: 'Notices' })).toHaveTextContent('Saved');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('a');
  });
});

describe('Dialog', () => {
  it('is labelled, described and closes with Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Title" description="Desc" closeLabel="Close">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Title' })).toHaveAccessibleDescription('Desc');
    expect(await axeViolations(document.body)).toEqual([]);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('breaks long titles without spaces instead of overflowing', () => {
    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        title="Averyveryverylonglabelwithoutanyspaces"
        description="Desc"
        closeLabel="Close"
      >
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('heading', { name: /^Averyvery/ })).toHaveClass('break-words');
  });
});
