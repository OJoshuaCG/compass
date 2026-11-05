import type { ManagedUser } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const ACTOR_ID = '5c9e6f3e-4c1a-4a53-9d9e-6b0f0a1f7a01';
const MARTA_ID = '22222222-2222-4222-8222-222222222222';
const LUIS_ID = '11111111-1111-4111-8111-111111111111';
const HIERARCHY_URL = '/users?view=hierarchy';

const person = (overrides: Partial<ManagedUser>): ManagedUser => ({
  id: MARTA_ID,
  displayName: 'Marta Ruiz',
  email: 'marta@example.com',
  rank: 2,
  status: 'active',
  managedBy: ACTOR_ID,
  managerName: null,
  roleNames: null,
  ...overrides,
});

function hierarchyApi(managed: ManagedUser[], permissions: Parameters<typeof meFixture>[0] = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: ['user.deactivate'], ...permissions })),
    'GET /users': jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    'GET /users/managed': () =>
      jsonResponse({ data: managed, page: { nextCursor: null, limit: 100 } }),
  });
}

describe('hierarchy tab', () => {
  it('shows the actor as root with the people nested under their manager', async () => {
    hierarchyApi([
      person({}),
      person({ id: LUIS_ID, displayName: 'Luis Gómez', rank: 3, managedBy: MARTA_ID }),
    ]);
    renderApp(HIERARCHY_URL);

    const region = await screen.findByRole('region', { name: es.directory['hierarchy.label'] });
    const items = within(region).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ana Pérez');
    expect(items[0]).toHaveTextContent(es.directory['hierarchy.you']);
    // Luis cuelga de Marta: está dentro de su elemento de lista.
    const marta = within(region).getByText('Marta Ruiz').closest('li');
    expect(marta).not.toBeNull();
    expect(within(marta as HTMLElement).getByText('Luis Gómez')).toBeInTheDocument();
    expect(await axeViolations(region)).toEqual([]);
  });

  it('shows people without a loaded manager in their own group', async () => {
    hierarchyApi([person({ managedBy: '99999999-9999-4999-8999-999999999999' })]);
    renderApp(HIERARCHY_URL);

    expect(await screen.findByText(es.directory['hierarchy.detached.title'])).toBeInTheDocument();
    expect(screen.getByText('Marta Ruiz')).toBeInTheDocument();
  });

  it('shows an empty state when nobody reports to the actor', async () => {
    hierarchyApi([]);
    renderApp(HIERARCHY_URL);

    expect(await screen.findByText(es.directory['hierarchy.empty.title'])).toBeInTheDocument();
  });

  it('is hidden without management permissions, even with ?view=hierarchy in the URL', async () => {
    hierarchyApi([], { permissions: ['user.invite'] });
    renderApp(HIERARCHY_URL);

    await screen.findByRole('table', { name: es.directory['users.caption'] });
    expect(screen.queryByRole('tab', { name: es.directory['users.tabs.hierarchy'] })).toBeNull();
  });
});
