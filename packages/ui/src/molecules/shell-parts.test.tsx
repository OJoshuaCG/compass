import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, initialsOf } from '../atoms/avatar';
import { BrandMark } from '../atoms/brand-mark';
import { axeViolations } from '../test/axe';

import { Card, CardBody, CardHeader } from './card';
import { NavGroup, NavItem } from './nav-item';

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
