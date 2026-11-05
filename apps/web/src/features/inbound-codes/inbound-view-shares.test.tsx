import type {
  DirectoryUser,
  InboundConfigurableView,
  InboundViewShare,
  Permission,
} from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const MANAGE_VIEW_ID = '22222222-2222-4222-8222-222222222221';
const EDIT_VIEW_ID = '22222222-2222-4222-8222-222222222222';
const UNLISTED_VIEW_ID = '22222222-2222-4222-8222-222222222229';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333331';
const SHARE_ID = '66666666-6666-4666-8666-666666666661';
const GROUP_SHARE_ID = '66666666-6666-4666-8666-666666666662';
const NEW_SHARE_ID = '66666666-6666-4666-8666-666666666663';
const GRANTEE_ID = '77777777-7777-4777-8777-777777777771';
const GROUP_ID = '77777777-7777-4777-8777-777777777772';
const CANDIDATE_ID = '77777777-7777-4777-8777-777777777773';
// Coincide con el usuario de `meFixture`: la búsqueda no debe ofrecerlo.
const SELF_ID = '5c9e6f3e-4c1a-4a53-9d9e-6b0f0a1f7a01';

const PAGE = `/inbound/views/${MANAGE_VIEW_ID}/shares`;
const SHARES_PATH = `/inbound/views/${MANAGE_VIEW_ID}/shares`;
const SETTINGS_PAGE = '/inbound/view-settings';
const ALL_PERMISSIONS: Permission[] = ['inbound.configure', 'share.manage'];

const withName = (template: string, name: string) => template.replace('{{name}}', name);

const viewFixture = (
  overrides: Partial<InboundConfigurableView> = {},
): InboundConfigurableView => ({
  id: MANAGE_VIEW_ID,
  sourceId: SOURCE_ID,
  name: 'Vista de accesos',
  templateIds: [TEMPLATE_ID],
  createdAt: '2026-02-01T12:00:00.000Z',
  level: 'MANAGE',
  ...overrides,
});

const MANAGED_VIEW = viewFixture();
const EDITABLE_VIEW = viewFixture({ id: EDIT_VIEW_ID, name: 'Vista de soporte', level: 'EDIT' });

const PERSON_SHARE: InboundViewShare = {
  id: SHARE_ID,
  viewId: MANAGE_VIEW_ID,
  granteeType: 'user',
  granteeId: GRANTEE_ID,
  granteeName: 'Luis Gómez',
  level: 'USE',
  expiresAt: null,
  grantedBy: SELF_ID,
  createdAt: '2026-02-03T12:00:00.000Z',
};
const GROUP_SHARE: InboundViewShare = {
  id: GROUP_SHARE_ID,
  viewId: MANAGE_VIEW_ID,
  granteeType: 'group',
  granteeId: GROUP_ID,
  granteeName: 'Soporte nivel 2',
  level: 'VIEW',
  expiresAt: '2030-06-01T12:00:00.000Z',
  grantedBy: SELF_ID,
  createdAt: '2026-02-04T12:00:00.000Z',
};

const CANDIDATE: DirectoryUser = {
  id: CANDIDATE_ID,
  displayName: 'María Ruiz',
  email: 'maria@example.com',
  rank: 2,
};
const SELF_CANDIDATE: DirectoryUser = {
  id: SELF_ID,
  displayName: 'Ana Pérez',
  email: 'ana@example.com',
  rank: 1,
};

type Routes = Parameters<typeof stubApi>[0];

function setup(
  options: {
    permissions?: Permission[];
    views?: InboundConfigurableView[];
    shares?: InboundViewShare[];
    extra?: Routes;
  } = {},
) {
  const {
    permissions = ALL_PERMISSIONS,
    views = [MANAGED_VIEW, EDITABLE_VIEW],
    shares = [PERSON_SHARE, GROUP_SHARE],
    extra = {},
  } = options;
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    'GET /inbound/configurable-views': jsonResponse({ data: views }),
    'GET /inbound/sources': jsonResponse({ data: [] }),
    'GET /inbound/templates': jsonResponse({ data: [] }),
    'GET /inbound/views': jsonResponse({ data: [] }),
    [`GET ${SHARES_PATH}`]: jsonResponse({ data: shares }),
    'GET /users': jsonResponse({
      data: [SELF_CANDIDATE, CANDIDATE],
      page: { nextCursor: null, limit: 25 },
    }),
    ...extra,
  });
}

const rowsLoaded = () => screen.findByRole('cell', { name: PERSON_SHARE.granteeName });
const revokeLabel = (name: string) => withName(es.shares['action.revokeLabel'], name);
const sharesLinkLabel = (name: string) => withName(t['viewSettings.action.sharesLabel'], name);

async function openShareDialog(user: ReturnType<typeof userEvent.setup>) {
  await rowsLoaded();
  await user.click(screen.getByRole('button', { name: t['viewSettings.shares.open'] }));
  return screen.findByRole('dialog', {
    name: withName(t['viewSettings.shares.share.title'], MANAGED_VIEW.name),
  });
}

async function pickCandidate(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(
    await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
  );
}

describe('view shares list', () => {
  it('lists people and groups with the view wording, without violations', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    expect(
      screen.getByRole('heading', {
        name: withName(t['viewSettings.shares.title'], MANAGED_VIEW.name),
      }),
    ).toBeVisible();
    const table = screen.getByRole('table', { name: t['viewSettings.shares.caption'] });
    const groupRow = within(table).getByRole('row', { name: /Soporte nivel 2/ });
    expect(within(groupRow).getByText(es.shares['granteeType.group'])).toBeVisible();
    expect(within(groupRow).getByText(es.shares['level.VIEW'])).toBeVisible();
    const personRow = within(table).getByRole('row', { name: /Luis Gómez/ });
    expect(within(personRow).getByText(es.shares['expires.never'])).toBeVisible();
    expect(await axeViolations(table)).toEqual([]);
  });

  it('shows the view empty state', async () => {
    setup({ shares: [] });
    renderApp(PAGE);
    expect(await screen.findByText(t['viewSettings.shares.empty.title'])).toBeVisible();
    expect(screen.getByText(t['viewSettings.shares.empty.description'])).toBeVisible();
  });

  it('shows the translated error when the list is denied', async () => {
    setup({ extra: { [`GET ${SHARES_PATH}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
  });

  it('answers not found for a view that is not in the configurable list', async () => {
    const unlistedSharesPath = `/inbound/views/${UNLISTED_VIEW_ID}/shares`;
    const api = setup({ extra: { [`GET ${unlistedSharesPath}`]: problem(404, 'NOT_FOUND') } });
    renderApp(`/inbound/views/${UNLISTED_VIEW_ID}/shares`);
    expect(await screen.findByText(t['viewSettings.shares.notFound'])).toBeVisible();
    expect(api.callsTo('GET', unlistedSharesPath)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: t['viewSettings.shares.open'] })).toBeNull();
    expect(screen.getByRole('link', { name: t['viewSettings.shares.back'] })).toHaveAttribute(
      'href',
      SETTINGS_PAGE,
    );
  });

  it('answers not found for an identifier that is not a UUID, without calling the API', async () => {
    const api = setup();
    renderApp('/inbound/views/no-es-uuid/shares');
    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible();
    expect(api.callsTo('GET', '/inbound/views/no-es-uuid/shares')).toHaveLength(0);
    expect(api.callsTo('GET', '/inbound/configurable-views')).toHaveLength(0);
  });
});

describe('action gating by level and permission', () => {
  it('links to the accesses only for MANAGE views with share.manage', async () => {
    const user = userEvent.setup();
    setup();
    const { router } = renderApp(SETTINGS_PAGE);
    const link = await screen.findByRole('link', { name: sharesLinkLabel(MANAGED_VIEW.name) });
    expect(screen.queryByRole('link', { name: sharesLinkLabel(EDITABLE_VIEW.name) })).toBeNull();
    await user.click(link);
    expect(await rowsLoaded()).toBeVisible();
    expect(router.state.location.pathname).toBe(PAGE);
  });

  it('does not link to the accesses without share.manage', async () => {
    setup({ permissions: ['inbound.configure'] });
    renderApp(SETTINGS_PAGE);
    await screen.findByRole('cell', { name: MANAGED_VIEW.name });
    expect(screen.queryByRole('link', { name: sharesLinkLabel(MANAGED_VIEW.name) })).toBeNull();
  });

  // El servidor solo lista los accesos con las dos llaves: sin alguna, la página no los pide (cada
  // intento sería una negación auditada) y responde como a una vista que no administra.
  it('answers not found on the page without share.manage, without asking for the list', async () => {
    const api = setup({ permissions: ['inbound.configure'] });
    renderApp(PAGE);
    expect(await screen.findByText(t['viewSettings.shares.notFound'])).toBeVisible();
    expect(api.callsTo('GET', SHARES_PATH)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: t['viewSettings.shares.open'] })).toBeNull();
    expect(screen.queryByRole('button', { name: revokeLabel('Luis Gómez') })).toBeNull();
  });

  it('answers not found on the page below MANAGE, without asking for the list', async () => {
    const api = setup({ views: [viewFixture({ level: 'EDIT' })] });
    renderApp(PAGE);
    expect(await screen.findByText(t['viewSettings.shares.notFound'])).toBeVisible();
    expect(api.callsTo('GET', SHARES_PATH)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: t['viewSettings.shares.open'] })).toBeNull();
    expect(screen.queryByRole('button', { name: revokeLabel('Luis Gómez') })).toBeNull();
  });
});

describe('share a view', () => {
  it('describes each level with what it allows on a view, without violations', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    const levelSelect = field(es.shares['share.level']);
    for (const level of ['USE', 'VIEW', 'EDIT', 'MANAGE'] as const) {
      expect(
        within(levelSelect).getByRole('option', {
          name: t[`viewSettings.shares.levelOption.${level}`],
        }),
      ).toHaveValue(level);
    }
    expect(levelSelect).toHaveValue('USE');
    expect(
      within(dialog).queryByRole('radio', { name: new RegExp(SELF_CANDIDATE.displayName) }),
    ).toBeNull();
    const submit = within(dialog).getByRole('button', {
      name: t['viewSettings.shares.share.submit'],
    });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(t['viewSettings.shares.share.submitHint']);
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('shares with the chosen person and level, shows a toast and reloads the list', async () => {
    const user = userEvent.setup();
    const created: InboundViewShare = {
      ...PERSON_SHARE,
      id: NEW_SHARE_ID,
      granteeId: CANDIDATE_ID,
      granteeName: CANDIDATE.displayName,
      level: 'VIEW',
    };
    const api = setup({ extra: { [`POST ${SHARES_PATH}`]: jsonResponse(created, 201) } });
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    await user.selectOptions(field(es.shares['share.level']), 'VIEW');
    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.shares.share.submit'] }),
    );

    expect(
      await screen.findByText(
        withName(t['viewSettings.shares.share.toast'], CANDIDATE.displayName),
      ),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', SHARES_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ granteeType: 'user', granteeId: CANDIDATE_ID, level: 'VIEW' });
    expect(posts[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => {
      expect(api.callsTo('GET', SHARES_PATH).length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the translated error and keeps the dialog open when the grantee already has access', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`POST ${SHARES_PATH}`]: problem(409, 'SHARE.ALREADY_EXISTS') } });
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.shares.share.submit'] }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['SHARE.ALREADY_EXISTS'],
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('sends nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo('POST', SHARES_PATH)).toHaveLength(0);
  });
});

describe('revoke a view share', () => {
  const revokePath = `${SHARES_PATH}/${SHARE_ID}/revoke`;

  async function openRevoke(user: ReturnType<typeof userEvent.setup>) {
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revokeLabel('Luis Gómez') }));
    return screen.findByRole('dialog', {
      name: withName(t['viewSettings.shares.revoke.title'], 'Luis Gómez'),
    });
  }

  it('warns about the rotation task, revokes, shows a toast and reloads', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${revokePath}`]: noContent() } });
    renderApp(PAGE);
    const dialog = await openRevoke(user);
    expect(
      within(dialog).getByText(withName(t['viewSettings.shares.revoke.description'], 'Luis Gómez')),
    ).toBeVisible();
    expect(api.callsTo('POST', revokePath)).toHaveLength(0);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.shares.revoke.confirm'] }),
    );
    expect(
      await screen.findByText(withName(t['viewSettings.shares.revoke.toast'], 'Luis Gómez')),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', revokePath)).toHaveLength(1);
    await waitFor(() => {
      expect(api.callsTo('GET', SHARES_PATH).length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not revoke when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${revokePath}`]: noContent() } });
    renderApp(PAGE);
    const dialog = await openRevoke(user);
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo('POST', revokePath)).toHaveLength(0);
  });

  it('shows the translated error and keeps the dialog open when the server denies it', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`POST ${revokePath}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await openRevoke(user);
    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.shares.revoke.confirm'] }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  // Un 404 no prueba la revocación (también responde así si quien revoca perdió la vista): no se
  // anuncia éxito, el error queda a la vista y se recargan los listados.
  it('does not announce success when the share or the view is gone, and reloads', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${revokePath}`]: problem(404, 'NOT_FOUND') } });
    renderApp(PAGE);
    const dialog = await openRevoke(user);
    await user.click(
      within(dialog).getByRole('button', { name: t['viewSettings.shares.revoke.confirm'] }),
    );
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(
      screen.queryByText(withName(t['viewSettings.shares.revoke.toast'], PERSON_SHARE.granteeName)),
    ).toBeNull();
    await waitFor(() => {
      expect(api.callsTo('GET', SHARES_PATH).length).toBeGreaterThan(1);
    });
    expect(api.callsTo('GET', '/inbound/configurable-views').length).toBeGreaterThan(1);
  });
});
