import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';

import { RadioGroup } from './radio-group';
import { RowActionsMenu } from './row-actions-menu';
import { Tabs } from './tabs';

describe('RowActionsMenu', () => {
  it('renders nothing without items', () => {
    const { container } = render(<RowActionsMenu label="Actions for Ana" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens with the keyboard, runs the chosen action and closes', async () => {
    const user = userEvent.setup();
    const onSuspend = vi.fn();
    const { container } = render(
      <RowActionsMenu
        label="Actions for Ana"
        items={[
          { id: 'suspend', label: 'Suspend', onSelect: onSuspend },
          { id: 'remove', label: 'Remove', onSelect: vi.fn(), tone: 'danger' },
        ]}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    // El menú se carga de forma diferida: primero llega un botón deshabilitado y luego el real.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Actions for Ana' })).toBeEnabled();
    });
    screen.getByRole('button', { name: 'Actions for Ana' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Remove' })).toBeInTheDocument();
    // El menú vive en un portal: se audita su propio nodo (la regla de regiones es de página).
    expect(await axeViolations(screen.getByRole('menu'))).toEqual([]);
    await user.keyboard('{Enter}');
    expect(onSuspend).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});

describe('Tabs', () => {
  function Harness() {
    const [value, setValue] = useState('a');
    return (
      <Tabs
        label="Sections"
        tabs={[
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ]}
        value={value}
        onValueChange={setValue}
      >
        <p>{`Panel ${value}`}</p>
      </Tabs>
    );
  }

  it('links the active tab to its panel, moves with arrow keys and has no violations', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const first = screen.getByRole('tab', { name: 'First' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'First' })).toHaveTextContent('Panel a');
    expect(await axeViolations(container)).toEqual([]);

    first.focus();
    await user.keyboard('{ArrowRight}');
    const second = screen.getByRole('tab', { name: 'Second' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Second' })).toHaveTextContent('Panel b');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'First' })).toHaveFocus();
  });
});

describe('RadioGroup', () => {
  it('selects one option, reports it and has no violations', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <RadioGroup
        legend="Manager"
        options={[
          { value: '1', label: 'Ana', description: 'ana@example.com' },
          { value: '2', label: 'Luis' },
        ]}
        value="1"
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('radio', { name: /Ana/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Luis' }));
    expect(onValueChange).toHaveBeenCalledWith('2');
    expect(await axeViolations(container)).toEqual([]);
  });
});
