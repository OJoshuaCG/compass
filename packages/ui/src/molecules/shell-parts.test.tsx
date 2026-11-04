import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Avatar, initialsOf } from '../atoms/avatar';
import { BrandMark } from '../atoms/brand-mark';
import { AppShell, SIDEBAR_ID } from '../organisms/app-shell';
import { axeViolations } from '../test/axe';

import { Card, CardBody, CardHeader } from './card';
import { NavGroup, NavItem } from './nav-item';
import { UserMenu } from './user-menu';

describe('initialsOf', () => {
  it.each([
    ['Cero User', 'CU'],
    ['  ana   maria   lopez ', 'AM'],
    ['beto', 'B'],
    ['', ''],
  ])('turns %j into %j', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe('Avatar and BrandMark', () => {
  it('hide their decorative content from assistive technology', () => {
    const { container } = render(
      <>
        <Avatar name="Cero User" />
        <BrandMark />
      </>,
    );
    const decorative = container.querySelectorAll('[aria-hidden="true"]');
    expect(decorative).toHaveLength(2);
    expect(screen.queryByText('CU')).toBeInTheDocument();
  });
});

describe('NavGroup and NavItem', () => {
  it('names the list with the group label', () => {
    render(
      <NavGroup label="Workspace">
        <li>
          <NavItem href="#home" icon={<svg />}>
            Home
          </NavItem>
        </li>
      </NavGroup>,
    );
    expect(screen.getByRole('list', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('marks only the active item with aria-current', () => {
    render(
      <NavGroup label="Workspace">
        <li>
          <NavItem href="#home" icon={<svg />} active>
            Home
          </NavItem>
        </li>
        <li>
          <NavItem href="#users" icon={<svg />}>
            Users
          </NavItem>
        </li>
      </NavGroup>,
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <nav aria-label="Main">
        <NavGroup label="Vault">
          <li>
            <NavItem href="#accounts" icon={<svg />} active>
              Accounts
            </NavItem>
          </li>
        </NavGroup>
      </nav>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Card', () => {
  it('renders header and body inside a section', () => {
    render(
      <Card aria-label="Summary">
        <CardHeader>Head</CardHeader>
        <CardBody>Body</CardBody>
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Summary' });
    expect(card).toHaveTextContent('Head');
    expect(card).toHaveTextContent('Body');
  });
});

describe('UserMenu', () => {
  const renderMenu = (onLogout = vi.fn(), pending = false) =>
    render(
      <UserMenu
        name="Ana Pérez"
        details={<span>Administrador</span>}
        actions={[{ id: 'logout', label: 'Cerrar sesión', onSelect: onLogout, pending }]}
      />,
    );

  // El menú se descarga de forma diferida: mientras tanto hay un botón de respaldo con el mismo nombre,
  // deshabilitado y sin `aria-haspopup`. Se espera al botón real, como lo haría quien usa la pantalla.
  const findRealTrigger = () =>
    waitFor(() => {
      const trigger = screen.getByRole('button', { name: 'Ana Pérez' });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      return trigger;
    });

  it('shows only the trigger named after the person until it is opened', async () => {
    renderMenu();
    await findRealTrigger();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens with name, rank and the action, and runs the action on select', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderMenu(onLogout);
    await user.click(await findRealTrigger());
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Ana Pérez');
    expect(menu).toHaveTextContent('Administrador');
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape and returns the focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = await findRealTrigger();
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disables a pending action so it cannot be fired twice', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderMenu(onLogout, true);
    await user.click(await findRealTrigger());
    const item = await screen.findByRole('menuitem', { name: 'Cerrar sesión' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('aria-busy', 'true');
    await user.click(item);
    expect(onLogout).not.toHaveBeenCalled();
  });
});

describe('AppShell sidebar visibility', () => {
  const renderShell = (sidebarHidden = false) =>
    render(
      <AppShell
        sidebar={<nav aria-label="Main">links</nav>}
        header={<span>Compass</span>}
        skipLinkLabel="Skip"
        sidebarHidden={sidebarHidden}
      >
        content
      </AppShell>,
    );

  it('shows the sidebar by default (backwards compatible)', () => {
    renderShell();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(document.getElementById(SIDEBAR_ID)).not.toHaveAttribute('hidden');
  });

  it('hides the sidebar from the page and the accessibility tree but keeps the content', () => {
    renderShell(true);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(document.getElementById(SIDEBAR_ID)).toHaveAttribute('hidden');
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });
});
