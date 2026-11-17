import { loadCredentialsCatalog } from '@iam/i18n';
import type { CredentialHealthSummary, Group, Permission } from '@iam/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const GROUP_ID = '66666666-6666-4666-8666-666666666661';
const OTHER_GROUP_ID = '66666666-6666-4666-8666-666666666662';
const PAGE = '/credential-health';
const copy = es.credentials;
const VIEW_HEALTH: Permission[] = ['credential.view_health'];

const group = (id: string, name: string): Group => ({
  id,
  name,
  description: null,
  memberCount: 3,
  myRole: null,
  canManageMembers: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const groups = [group(GROUP_ID, 'Finanzas'), group(OTHER_GROUP_ID, 'Soporte')];

const summary = (overrides: Partial<CredentialHealthSummary> = {}): CredentialHealthSummary => ({
  credentials: 12,
  withSignals: 7,
  strengthUnknown: 2,
  bySignal: {
    weak_password: 3,
    reused_password: 5,
    stale_password: 0,
    totp_missing: 8,
    totp_pending: 1,
    totp_exposed: 0,
    rotation_pending: 5,
  },
  ...overrides,
});

const emptySummary = summary({
  credentials: 0,
  withSignals: 0,
  strengthUnknown: 0,
  bySignal: {
    weak_password: 0,
    reused_password: 0,
    stale_password: 0,
    totp_missing: 0,
    totp_pending: 0,
    totp_exposed: 0,
    rotation_pending: 0,
  },
});

const proportion = (catalog: Record<string, string>, value: number, total: number) =>
  (catalog['healthSummary.proportion'] ?? '')
    .replace('{{value}}', String(value))
    .replace('{{total}}', String(total));

function setupAs(rank: 0 | 1 | 2 | 3, permissions: Permission[] = VIEW_HEALTH) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank })),
    'GET /groups': jsonResponse({ data: groups }),
    'GET /credential-health/organization': jsonResponse({ data: summary() }),
    [`GET /credential-health/groups/${GROUP_ID}`]: jsonResponse({
      data: summary({
        credentials: 4,
        withSignals: 2,
        strengthUnknown: 0,
        bySignal: {
          weak_password: 1,
          reused_password: 0,
          stale_password: 0,
          totp_missing: 0,
          totp_pending: 0,
          totp_exposed: 0,
          rotation_pending: 0,
        },
      }),
    }),
  });
}

async function chooseGroup(id: string) {
  const user = userEvent.setup();
  const select = await screen.findByRole('combobox', { name: copy['healthSummary.group.label'] });
  await user.selectOptions(select, id);
}

describe('credential health summary panels', () => {
  it('shows the organization panel and the group selector to an Administrator', async () => {
    const api = setupAs(1);
    renderApp(PAGE);

    expect(
      await screen.findByRole('heading', { level: 1, name: copy['healthSummary.title'] }),
    ).toBeInTheDocument();
    const organization = await screen.findByRole('region', {
      name: copy['healthSummary.organization.title'],
    });
    expect(await within(organization).findByText(proportion(copy, 7, 12))).toBeInTheDocument();
    expect(
      await screen.findByRole('combobox', { name: copy['healthSummary.group.label'] }),
    ).toBeInTheDocument();
    expect(api.callsTo('GET', '/credential-health/organization')).toHaveLength(1);
  });

  it('hides the organization panel from a Leader and never calls its endpoint, but keeps the group panel', async () => {
    const api = setupAs(2);
    renderApp(PAGE);

    await chooseGroup(GROUP_ID);
    const groupRegion = screen.getByRole('region', { name: copy['healthSummary.group.title'] });
    expect(await within(groupRegion).findByText(proportion(copy, 2, 4))).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: copy['healthSummary.organization.title'] }),
    ).toBeNull();
    expect(api.callsTo('GET', '/credential-health/organization')).toHaveLength(0);
    expect(api.callsTo('GET', `/credential-health/groups/${GROUP_ID}`)).toHaveLength(1);
  });

  it('offers the menu link only with the credential.view_health permission', async () => {
    setupAs(1, VIEW_HEALTH);
    const first = renderApp('/');
    const link = await screen.findByRole('link', { name: es.common['nav.credentialHealth'] });
    expect(link).toHaveAttribute('href', '/credential-health');
    first.unmount();

    setupAs(1, []);
    renderApp('/');
    await screen.findByRole('navigation', { name: es.common['nav.label'] });
    expect(screen.queryByRole('link', { name: es.common['nav.credentialHealth'] })).toBeNull();
  });

  it('shows the empty state when there are no credentials', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: VIEW_HEALTH, rank: 1 })),
      'GET /groups': jsonResponse({ data: groups }),
      'GET /credential-health/organization': jsonResponse({ data: emptySummary }),
    });
    renderApp(PAGE);

    const organization = await screen.findByRole('region', {
      name: copy['healthSummary.organization.title'],
    });
    expect(
      await within(organization).findByText(copy['healthSummary.empty.title']),
    ).toBeInTheDocument();
    expect(within(organization).queryByRole('list')).toBeNull();
  });

  it('shows an accessible error for a group the server does not let the person see, revealing nothing else', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: VIEW_HEALTH, rank: 2 })),
      'GET /groups': jsonResponse({ data: groups }),
      [`GET /credential-health/groups/${OTHER_GROUP_ID}`]: problem(404, 'GROUP.NOT_FOUND'),
    });
    renderApp(PAGE);

    await chooseGroup(OTHER_GROUP_ID);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors['GROUP.NOT_FOUND']);
    // Un 404 no mejora al repetir: no se ofrece "Reintentar".
    expect(within(alert).queryByRole('button', { name: es.common['actions.retry'] })).toBeNull();
    // El menú lateral también tiene listas: se revisa solo la tarjeta del grupo.
    const groupRegion = screen.getByRole('region', { name: copy['healthSummary.group.title'] });
    expect(within(groupRegion).queryByRole('list')).toBeNull();
  });

  it('shows each signal with its count out of the total, sorted from most to least, and the unmeasured strength', async () => {
    setupAs(1);
    renderApp(PAGE);

    const organization = await screen.findByRole('region', {
      name: copy['healthSummary.organization.title'],
    });
    const items = await within(organization).findAllByRole('listitem');
    // El empate (5 y 5; 0 y 0) conserva el orden fijo de las señales.
    const expectedOrder: [string, number][] = [
      ['totp_missing', 8],
      ['reused_password', 5],
      ['rotation_pending', 5],
      ['weak_password', 3],
      ['totp_pending', 1],
      ['stale_password', 0],
      ['totp_exposed', 0],
    ];
    expect(items.map((item) => item.textContent)).toEqual(
      expectedOrder.map(
        ([signal, count]) =>
          `${copy[`health.signal.${signal}` as keyof typeof copy]}${proportion(copy, count, 12)}`,
      ),
    );

    const unknownLabel = within(organization).getByText(copy['healthSummary.strengthUnknown']);
    expect(unknownLabel.nextElementSibling).toHaveTextContent('2');

    // Con 0 sin medir la línea no aparece (el panel del grupo trae strengthUnknown: 0).
    await chooseGroup(GROUP_ID);
    const groupRegion = screen.getByRole('region', { name: copy['healthSummary.group.title'] });
    await within(groupRegion).findByText(proportion(copy, 2, 4));
    expect(within(groupRegion).queryByText(copy['healthSummary.strengthUnknown'])).toBeNull();
  });

  it('has no accessibility violations with both panels loaded', async () => {
    setupAs(1);
    const { container } = renderApp(PAGE);

    await chooseGroup(GROUP_ID);
    const groupRegion = screen.getByRole('region', { name: copy['healthSummary.group.title'] });
    await within(groupRegion).findByText(proportion(copy, 2, 4));
    await screen.findByText(proportion(copy, 7, 12));

    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when there are no groups to choose from', async () => {
    stubApi({
      'GET /me': jsonResponse(meFixture({ permissions: VIEW_HEALTH, rank: 2 })),
      'GET /groups': jsonResponse({ data: [] }),
    });
    renderApp(PAGE);

    expect(await screen.findByText(copy['healthSummary.group.none'])).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('credential health summary in English', () => {
  it('has every healthSummary key in both languages with the same plural forms', async () => {
    const en = (await loadCredentialsCatalog())['en-US'];
    const summaryKeys = (catalog: Record<string, string>) =>
      Object.keys(catalog)
        .filter((key) => key.startsWith('healthSummary.'))
        .sort();
    expect(summaryKeys(en)).toEqual(summaryKeys(copy));
    expect(summaryKeys(en).length).toBeGreaterThan(0);
  });

  it('renders the screen and the menu link in English', async () => {
    const en = (await loadCredentialsCatalog())['en-US'];
    setupAs(1);
    renderApp(PAGE, 'en-US');

    expect(
      await screen.findByRole('heading', { level: 1, name: en['healthSummary.title'] }),
    ).toBeInTheDocument();
    const organization = await screen.findByRole('region', {
      name: en['healthSummary.organization.title'],
    });
    expect(
      await within(organization).findByText(en['health.signal.totp_missing']),
    ).toBeInTheDocument();
    expect(within(organization).getByText(proportion(en, 7, 12))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credential health' })).toHaveAttribute(
      'href',
      '/credential-health',
    );
  });
});
