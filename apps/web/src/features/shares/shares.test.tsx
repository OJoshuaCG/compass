import type { Account, DirectoryUser, Permission, Share, ShareLevel } from '@iam/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333331';
const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const SHARE_ID = '66666666-6666-4666-8666-666666666661';
const GROUP_SHARE_ID = '66666666-6666-4666-8666-666666666662';
const GRANTEE_ID = '77777777-7777-4777-8777-777777777771';
const GROUP_ID = '77777777-7777-4777-8777-777777777772';
// Coincide con el usuario de `meFixture`: la búsqueda no debe ofrecerlo.
const SELF_ID = '5c9e6f3e-4c1a-4a53-9d9e-6b0f0a1f7a01';

const PAGE = `/accounts/${ACCOUNT_ID}/shares`;
const SHARES_PATH = `/accounts/${ACCOUNT_ID}/shares`;

const accountFixture = (myLevel: ShareLevel | null): Account => ({
  id: ACCOUNT_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const PERSON_SHARE: Share = {
  id: SHARE_ID,
  accountId: ACCOUNT_ID,
  granteeType: 'user',
  granteeId: GRANTEE_ID,
  granteeName: 'Luis Gómez',
  level: 'VIEW',
  expiresAt: null,
  grantedBy: SELF_ID,
  createdAt: '2026-02-01T12:00:00.000Z',
};
const GROUP_SHARE: Share = {
  id: GROUP_SHARE_ID,
  accountId: ACCOUNT_ID,
  granteeType: 'group',
  granteeId: GROUP_ID,
  granteeName: 'Contabilidad',
  level: 'EDIT',
  expiresAt: '2030-06-01T12:00:00.000Z',
  grantedBy: SELF_ID,
  createdAt: '2026-02-02T12:00:00.000Z',
};

const CANDIDATE: DirectoryUser = {
  id: GRANTEE_ID,
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

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );

const revokeLabel = (name: string) => fill(es.shares['action.revokeLabel'], { name });

function setup(
  options: {
    level?: ShareLevel | null;
    permissions?: Permission[];
    extra?: Record<string, Parameters<typeof stubApi>[0][string]>;
  } = {},
) {
  const { level = 'MANAGE', permissions = ['share.manage'], extra = {} } = options;
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET /accounts/${ACCOUNT_ID}`]: jsonResponse(accountFixture(level)),
    [`GET ${SHARES_PATH}`]: jsonResponse({ data: [PERSON_SHARE, GROUP_SHARE] }),
    'GET /users': jsonResponse({
      data: [SELF_CANDIDATE, CANDIDATE],
      page: { nextCursor: null, limit: 25 },
    }),
    ...extra,
  });
}

const rowsLoaded = () => screen.findByRole('cell', { name: PERSON_SHARE.granteeName });

async function openShareDialog(user: ReturnType<typeof userEvent.setup>) {
  await rowsLoaded();
  await user.click(screen.getByRole('button', { name: es.shares['action.share'] }));
  return screen.findByRole('dialog', { name: es.shares['share.title'] });
}

/** Elige a la candidata y deja el formulario listo para enviar. */
async function pickCandidate(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(
    await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
  );
}

describe('shares list', () => {
  it('lists grantee, type, level, expiry and date, group shares included, without violations', async () => {
    setup();
    const { container } = renderApp(PAGE);
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.shares.caption });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        es.shares['col.grantee'],
        es.shares['col.type'],
        es.shares['col.level'],
        es.shares['col.expiresAt'],
        es.shares['col.createdAt'],
      ]),
    );
    expect(within(table).getByText(es.shares['granteeType.user'])).toBeInTheDocument();
    expect(within(table).getByText(es.shares['granteeType.group'])).toBeInTheDocument();
    expect(within(table).getByText('Contabilidad')).toBeInTheDocument();
    expect(within(table).getByText(es.shares['level.VIEW'])).toBeInTheDocument();
    expect(within(table).getByText(es.shares['level.EDIT'])).toBeInTheDocument();
    expect(within(table).getByText(es.shares['expires.never'])).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows an empty state', async () => {
    setup({ extra: { [`GET ${SHARES_PATH}`]: jsonResponse({ data: [] }) } });
    renderApp(PAGE);
    expect(await screen.findByText(es.shares['empty.title'])).toBeInTheDocument();
  });

  it('shows a translated error when the list is denied', async () => {
    setup({ extra: { [`GET ${SHARES_PATH}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });

  it('shows not found when the account is not visible', async () => {
    setup({ extra: { [`GET /accounts/${ACCOUNT_ID}`]: problem(404, 'NOT_FOUND') } });
    renderApp(PAGE);
    expect(await screen.findByRole('alert')).toHaveTextContent(es.errors.NOT_FOUND);
  });

  it('answers not found for an identifier that is not a UUID, without calling the API', async () => {
    const api = setup();
    renderApp('/accounts/no-es-uuid/shares');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(api.callsTo('GET', '/accounts/no-es-uuid')).toHaveLength(0);
  });

  it('is reachable from the accounts screen', async () => {
    const user = userEvent.setup();
    setup({
      extra: {
        'GET /accounts': jsonResponse({
          data: [accountFixture('MANAGE')],
          page: { nextCursor: null, limit: 25 },
        }),
        'GET /platforms': jsonResponse({ data: [] }),
      },
    });
    const { router } = renderApp('/accounts');
    await user.click(
      await screen.findByRole('link', {
        name: fill(es.accounts['action.shareLabel'], { name: 'Nómina' }),
      }),
    );
    await rowsLoaded();
    expect(router.state.location.pathname).toBe(PAGE);
  });
});

describe('action gating by level and permission', () => {
  it('MANAGE with share.manage offers sharing and revoking', async () => {
    setup();
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: es.shares['action.share'] })).toBeVisible();
    expect(screen.getByRole('button', { name: revokeLabel('Luis Gómez') })).toBeVisible();
    expect(screen.getByRole('button', { name: revokeLabel('Contabilidad') })).toBeVisible();
  });

  it('hides the actions below MANAGE even with the permission', async () => {
    setup({ level: 'EDIT' });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: es.shares['action.share'] })).toBeNull();
    expect(screen.queryByRole('button', { name: revokeLabel('Luis Gómez') })).toBeNull();
  });

  it('hides the actions at MANAGE without the share.manage permission', async () => {
    setup({ permissions: [] });
    renderApp(PAGE);
    await rowsLoaded();
    expect(screen.queryByRole('button', { name: es.shares['action.share'] })).toBeNull();
    expect(screen.queryByRole('button', { name: revokeLabel('Luis Gómez') })).toBeNull();
  });
});

describe('share dialog', () => {
  it('offers people but not the current user, and explains the groups limitation, without violations', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    expect(
      await within(dialog).findByRole('radio', { name: new RegExp(CANDIDATE.displayName) }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('radio', { name: new RegExp(SELF_CANDIDATE.displayName) }),
    ).toBeNull();
    expect(within(dialog).getByText(es.shares['share.groupsNote'])).toBeVisible();
    expect(within(dialog).getByText(es.shares['share.expiresAtHelp'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('keeps the submit button disabled until a person is chosen', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    const submit = within(dialog).getByRole('button', { name: es.shares['share.submit'] });
    expect(submit).toBeDisabled();
    await pickCandidate(user, dialog);
    expect(submit).toBeEnabled();
  });

  it('shares with the chosen person and level, shows a toast and reloads the list', async () => {
    const user = userEvent.setup();
    const created: Share = {
      ...PERSON_SHARE,
      id: GROUP_SHARE_ID,
      granteeName: 'María Ruiz',
      level: 'EDIT',
    };
    const api = setup({ extra: { [`POST ${SHARES_PATH}`]: jsonResponse(created, 201) } });
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    await user.selectOptions(field(es.shares['share.level']), 'EDIT');
    await user.click(within(dialog).getByRole('button', { name: es.shares['share.submit'] }));

    expect(
      await screen.findByText(fill(es.shares['share.toast'], { name: 'María Ruiz' })),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', SHARES_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ granteeType: 'user', granteeId: GRANTEE_ID, level: 'EDIT' });
    expect(posts[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => {
      expect(api.callsTo('GET', SHARES_PATH).length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('dialog', { name: es.shares['share.title'] })).toBeNull();
  });

  it('sends the expiry as an ISO instant when it is in the future', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${SHARES_PATH}`]: jsonResponse(PERSON_SHARE, 201) } });
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    fireEvent.change(field(es.shares['share.expiresAt']), {
      target: { value: '2999-01-31T18:30' },
    });
    await user.click(within(dialog).getByRole('button', { name: es.shares['share.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', SHARES_PATH)).toHaveLength(1);
    });
    const body = api.callsTo('POST', SHARES_PATH)[0]?.body as { expiresAt?: string };
    expect(body.expiresAt).toBe(new Date('2999-01-31T18:30').toISOString());
  });

  it('rejects a past expiry on the client and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    const dialog = await openShareDialog(user);
    await pickCandidate(user, dialog);
    fireEvent.change(field(es.shares['share.expiresAt']), {
      target: { value: '2001-01-01T10:00' },
    });
    await user.click(within(dialog).getByRole('button', { name: es.shares['share.submit'] }));
    expect(await within(dialog).findByText(es.shares['share.expiryPast'])).toBeVisible();
    expect(field(es.shares['share.expiresAt'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', SHARES_PATH)).toHaveLength(0);
  });

  it.each([
    ['409', 'SHARE.ALREADY_EXISTS'],
    ['422', 'SHARE.GRANTEE_INVALID'],
    ['422', 'SHARE.EXPIRY_INVALID'],
    ['403', 'AUTHZ.SHARE'],
  ])(
    'maps a %s %s response to its translated message and keeps the dialog open',
    async (status, code) => {
      const user = userEvent.setup();
      setup({ extra: { [`POST ${SHARES_PATH}`]: problem(Number(status), code) } });
      renderApp(PAGE);
      const dialog = await openShareDialog(user);
      await pickCandidate(user, dialog);
      await user.click(within(dialog).getByRole('button', { name: es.shares['share.submit'] }));
      const messages = es.errors as Record<string, string>;
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(messages[code] ?? code);
      expect(screen.getByRole('dialog', { name: es.shares['share.title'] })).toBeInTheDocument();
    },
  );
});

describe('revoke', () => {
  const revokePath = `${SHARES_PATH}/${SHARE_ID}/revoke`;

  it('asks for confirmation, warns about the rotation task, revokes, shows a toast and reloads', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${revokePath}`]: noContent() } });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revokeLabel('Luis Gómez') }));
    const dialog = await screen.findByRole('dialog', {
      name: fill(es.shares['revoke.title'], { name: 'Luis Gómez' }),
    });
    expect(
      within(dialog).getByText(fill(es.shares['revoke.description'], { name: 'Luis Gómez' })),
    ).toBeVisible();
    expect(api.callsTo('POST', revokePath)).toHaveLength(0);
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: es.shares['revoke.confirm'] }));
    expect(
      await screen.findByText(fill(es.shares['revoke.toast'], { name: 'Luis Gómez' })),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', revokePath)).toHaveLength(1);
    await waitFor(() => {
      expect(api.callsTo('GET', SHARES_PATH).length).toBeGreaterThan(1);
    });
  });

  it('does not revoke when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: { [`POST ${revokePath}`]: noContent() } });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revokeLabel('Luis Gómez') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo('POST', revokePath)).toHaveLength(0);
  });

  it('shows the translated error and keeps the dialog open when the server denies it', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`POST ${revokePath}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    await rowsLoaded();
    await user.click(screen.getByRole('button', { name: revokeLabel('Luis Gómez') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.shares['revoke.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});
