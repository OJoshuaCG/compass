import type { Permission, PermissionCatalogEntry, Role } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const CUSTOM: Role = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Soporte',
  isSystem: false,
  permissions: ['user.invite'],
};

const MINE: Permission[] = ['role.manage', 'user.invite'];

const CATALOG: PermissionCatalogEntry[] = [
  { permission: 'role.manage', maxRank: 1 },
  { permission: 'user.invite', maxRank: 2 },
  { permission: 'credential.use_totp', maxRank: 3 },
];

const label = (permission: string) =>
  (es.roles as Record<string, string>)[`permission.${permission}`] ?? permission;
const rankText = (rank: 0 | 1 | 2 | 3) =>
  es.roles['permissions.maxRank'].replace(
    '{{rank}}',
    (es.common as Record<string, string>)[`rank.${String(rank)}`] ?? '',
  );

function setup(catalog: Parameters<typeof stubApi>[0][string]) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: MINE, rank: 1 })),
    'GET /roles': jsonResponse({ data: [CUSTOM], page: { nextCursor: null, limit: 25 } }),
    'GET /permissions': catalog,
  });
}

async function openPermissionsTab(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('link', {
    name: es.roles['card.openLabel'].replace('{{name}}', 'Soporte'),
  });
  await user.click(screen.getByRole('tab', { name: es.roles['tabs.permissions'] }));
}

describe('roles screen tabs', () => {
  it('starts on the roles tab and does not request the catalog until the other tab is chosen', async () => {
    const api = setup(jsonResponse({ data: CATALOG }));
    renderApp('/roles');
    await screen.findByRole('link', {
      name: es.roles['card.openLabel'].replace('{{name}}', 'Soporte'),
    });
    expect(screen.getByRole('tab', { name: es.roles['tabs.roles'] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(api.callsTo('GET', '/permissions')).toHaveLength(0);
  });
});

describe('permissions catalog tab', () => {
  it('lists every permission by area with its highest rank, without violations', async () => {
    const user = userEvent.setup();
    setup(jsonResponse({ data: CATALOG }));
    const { container } = renderApp('/roles');
    await openPermissionsTab(user);

    const roleArea = (
      await screen.findByRole('heading', { name: es.roles['permission.group.role'], level: 2 })
    ).closest('section') as HTMLElement;
    expect(within(roleArea).getByText(label('role.manage'))).toBeVisible();
    expect(within(roleArea).getByText(rankText(1))).toBeVisible();

    const userArea = screen
      .getByRole('heading', { name: es.roles['permission.group.user'], level: 2 })
      .closest('section') as HTMLElement;
    expect(within(userArea).getByText(label('user.invite'))).toBeVisible();
    expect(within(userArea).getByText(rankText(2))).toBeVisible();

    const credentialArea = screen
      .getByRole('heading', { name: es.roles['permission.group.credential'], level: 2 })
      .closest('section') as HTMLElement;
    expect(within(credentialArea).getByText(rankText(3))).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the translated error with Retry when the catalog cannot be read', async () => {
    const user = userEvent.setup();
    let fail = true;
    setup(() => (fail ? problem(403, 'AUTHZ.PERMISSION') : jsonResponse({ data: CATALOG })));
    renderApp('/roles');
    await openPermissionsTab(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors['AUTHZ.PERMISSION']);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    expect(await screen.findByText(label('role.manage'))).toBeVisible();
  });

  it('shows the empty message when the catalog has no entries', async () => {
    const user = userEvent.setup();
    setup(jsonResponse({ data: [] }));
    renderApp('/roles');
    await openPermissionsTab(user);
    expect(await screen.findByText(es.roles['permissions.empty'])).toBeVisible();
  });
});
