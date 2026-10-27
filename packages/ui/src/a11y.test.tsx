import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import {
  AppShell,
  Badge,
  Button,
  ConfirmDialog,
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
});
