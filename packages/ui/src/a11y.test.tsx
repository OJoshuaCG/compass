import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import {
  Alert,
  AppShell,
  Badge,
  Button,
  Checkbox,
  CodeInput,
  ConfirmDialog,
  CopyButton,
  PasswordInput,
  StrengthMeter,
  ToastViewport,
  EmptyState,
  FormField,
  IconButton,
  Input,
  PageHeader,
  SearchInput,
  Skeleton,
  Spinner,
  StatusBadge,
} from './index';
import { axeViolations } from './test/axe';

describe('component accessibility (axe-core)', () => {
  it('atoms and molecules have no violations', async () => {
    const { container } = render(
      <div>
        <Button>Save</Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Settings" icon={<Settings />} />
        <Badge>Neutral</Badge>
        <Spinner label="Loading" />
        <Skeleton />
        <StatusBadge status="success" label="Active" />
        <StatusBadge status="danger" label="Failed" />
        <FormField label="Name" help="Help" error="Required" required>
          {(control) => <Input {...control} />}
        </FormField>
        <SearchInput label="Search" clearLabel="Clear" value="abc" onValueChange={vi.fn()} />
        <EmptyState title="Nothing" description="Come back later" action={<Button>Add</Button>} />
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('page structure has no violations', async () => {
    const { container } = render(
      <AppShell
        sidebar={<nav aria-label="Main">links</nav>}
        header={<span>IAM</span>}
        skipLinkLabel="Skip"
      >
        <PageHeader title="Home" description="Desc" actions={<Button>Act</Button>} />
      </AppShell>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('open confirm dialog has no violations and exposes a labelled dialog', async () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete?"
        description="Cannot be undone"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        tone="danger"
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete?' });
    expect(dialog).toHaveAccessibleDescription('Cannot be undone');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('ConfirmDialog behavior', () => {
  it('confirms and cancels', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Cannot be undone"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="d"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ignores Escape and disables Cancel while loading, so an in-flight result is not lost', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="d"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        loading
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Delete?' })).toBeInTheDocument();
  });

  it('disables only the confirm button with confirmDisabled and still allows closing', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="d"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        confirmDisabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('new form components accessibility (axe-core)', () => {
  it('PasswordInput, CodeInput, CopyButton, Checkbox, Alert, StrengthMeter and ToastViewport have no violations', async () => {
    const { container } = render(
      <div>
        <FormField label="Password">
          {(control) => (
            <PasswordInput {...control} showLabel="Show password" hideLabel="Hide password" />
          )}
        </FormField>
        <FormField label="Code">
          {(control) => <CodeInput {...control} value="123" onValueChange={vi.fn()} />}
        </FormField>
        <CopyButton value="x" label="Copy" copiedLabel="Copied" failedLabel="Failed" />
        <label>
          <Checkbox /> Saved
        </label>
        <Alert tone="warning">Careful</Alert>
        <StrengthMeter level={2} label="Strength" levelText="Fair" />
        <ToastViewport
          toasts={[{ id: '1', message: 'Done', tone: 'success' }]}
          onDismiss={vi.fn()}
          dismissLabel="Dismiss"
          regionLabel="Notices"
        />
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
