import type { DirectoryUser, Permission, RootTransfer } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PAGE = '/root-transfer';
const TRANSFER_PATH = '/root-transfer';

const ROOT_ID = '88888888-8888-4888-8888-888888888881';
const ADMIN_ID = '88888888-8888-4888-8888-888888888882';
const OTHER_ADMIN_ID = '88888888-8888-4888-8888-888888888883';

const person = (id: string, displayName: string, rank: DirectoryUser['rank']): DirectoryUser => ({
  id,
  displayName,
  email: `${displayName.toLowerCase().replace(' ', '.')}@example.com`,
  rank,
});

const ROOT_PERSON = person(ROOT_ID, 'Raúl Soto', 0);
const ADMIN_PERSON = person(ADMIN_ID, 'María Ruiz', 1);
const OTHER_ADMIN_PERSON = person(OTHER_ADMIN_ID, 'Pedro León', 1);

const openTransfer = (overrides: Partial<RootTransfer> = {}): RootTransfer => ({
  id: '99999999-9999-4999-8999-999999999991',
  fromUserId: ROOT_ID,
  toUserId: ADMIN_ID,
  status: 'pending_acceptance',
  requestedAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-08T10:00:00.000Z',
  acceptedAt: null,
  executesAt: null,
  ...overrides,
});

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, value),
    template,
  );

type Viewer = { rank: 0 | 1 | 2 | 3; id?: string; permissions?: Permission[] };

/** Prepara la API para quien mira la pantalla; `id` cambia el usuario que devuelve `GET /me`. */
function setup(
  viewer: Viewer,
  current: RootTransfer | null,
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
) {
  const me = meFixture({ rank: viewer.rank, permissions: viewer.permissions ?? [] });
  return stubApi({
    'GET /me': jsonResponse(
      viewer.id === undefined ? me : { ...me, user: { ...me.user, id: viewer.id } },
    ),
    [`GET ${TRANSFER_PATH}`]: jsonResponse({ data: current }),
    'GET /users': jsonResponse({
      data: [ROOT_PERSON, ADMIN_PERSON, OTHER_ADMIN_PERSON],
      page: { nextCursor: null, limit: 100 },
    }),
    ...extra,
  });
}

const ROOT_VIEWER: Viewer = { rank: 0, id: ROOT_ID, permissions: ['org.settings'] };
const RECIPIENT_VIEWER: Viewer = { rank: 1, id: ADMIN_ID };
const ADMIN_VIEWER: Viewer = { rank: 1, id: OTHER_ADMIN_ID };

const pageTitle = () => screen.findByRole('heading', { name: es.directory['rootTransfer.title'] });

describe('root transfer page', () => {
  it('shows the proposal form to the Root when nothing is open, offering only other Administrators', async () => {
    setup(ROOT_VIEWER, null);
    const { container } = renderApp(PAGE);
    await pageTitle();

    const group = await screen.findByRole('group', {
      name: es.directory['rootTransfer.propose.legend'],
    });
    expect(
      within(group).getByRole('radio', { name: new RegExp(ADMIN_PERSON.displayName) }),
    ).toBeVisible();
    expect(
      within(group).getByRole('radio', { name: new RegExp(OTHER_ADMIN_PERSON.displayName) }),
    ).toBeVisible();
    // La propia Raíz y quien no es Administrador no aparecen como opción.
    expect(
      within(group).queryByRole('radio', { name: new RegExp(ROOT_PERSON.displayName) }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: es.directory['rootTransfer.propose.submit'] }),
    ).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('proposes to the chosen Administrator, then shows the open transfer and a toast', async () => {
    const user = userEvent.setup();
    const proposed = openTransfer();
    const api = setup(ROOT_VIEWER, null, {
      [`POST ${TRANSFER_PATH}`]: jsonResponse({ data: proposed }, 201),
    });
    renderApp(PAGE);
    await pageTitle();

    await user.click(
      await screen.findByRole('radio', { name: new RegExp(ADMIN_PERSON.displayName) }),
    );
    await user.click(
      screen.getByRole('button', { name: es.directory['rootTransfer.propose.submit'] }),
    );

    expect(
      await screen.findByText(
        fill(es.directory['rootTransfer.proposed'], { name: ADMIN_PERSON.displayName }),
      ),
    ).toBeInTheDocument();
    const posts = api.callsTo('POST', TRANSFER_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ targetUserId: ADMIN_ID });
    expect(
      await screen.findByText(es.directory['rootTransfer.status.pending_acceptance']),
    ).toBeVisible();
    expect(
      screen.queryByRole('group', { name: es.directory['rootTransfer.propose.legend'] }),
    ).toBeNull();
  });

  it('shows a server rejection on the proposal without leaving the form', async () => {
    const user = userEvent.setup();
    setup(ROOT_VIEWER, null, {
      [`POST ${TRANSFER_PATH}`]: problem(422, 'ROOT_TRANSFER.TARGET_NOT_ELIGIBLE'),
    });
    renderApp(PAGE);
    await pageTitle();

    await user.click(
      await screen.findByRole('radio', { name: new RegExp(ADMIN_PERSON.displayName) }),
    );
    await user.click(
      screen.getByRole('button', { name: es.directory['rootTransfer.propose.submit'] }),
    );

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('group', { name: es.directory['rootTransfer.propose.legend'] }),
    ).toBeVisible();
  });

  it('tells an Administrator there is nothing in progress and offers no proposal form', async () => {
    setup(ADMIN_VIEWER, null);
    renderApp(PAGE);
    await pageTitle();

    expect(await screen.findByText(es.directory['rootTransfer.none'])).toBeVisible();
    expect(
      screen.queryByRole('group', { name: es.directory['rootTransfer.propose.legend'] }),
    ).toBeNull();
  });

  it('shows the open transfer with names and status, and lets the Root cancel but not accept', async () => {
    setup(ROOT_VIEWER, openTransfer());
    const { container } = renderApp(PAGE);
    await pageTitle();

    expect(await screen.findByText(ROOT_PERSON.displayName)).toBeVisible();
    expect(screen.getByText(ADMIN_PERSON.displayName)).toBeVisible();
    expect(screen.getByText(es.directory['rootTransfer.status.pending_acceptance'])).toBeVisible();
    expect(
      screen.getByRole('button', { name: es.directory['rootTransfer.cancel.action'] }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: es.directory['rootTransfer.accept.action'] }),
    ).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('lets the recipient accept after confirming, and shows the 72-hour wait', async () => {
    const user = userEvent.setup();
    const accepted = openTransfer({
      status: 'waiting',
      acceptedAt: '2026-11-02T10:00:00.000Z',
      executesAt: '2026-11-05T10:00:00.000Z',
    });
    const api = setup(RECIPIENT_VIEWER, openTransfer(), {
      [`POST ${TRANSFER_PATH}/accept`]: jsonResponse({ data: accepted }),
    });
    renderApp(PAGE);
    await pageTitle();

    expect(await screen.findByText(es.directory['rootTransfer.recipientNotice'])).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: es.directory['rootTransfer.accept.action'] }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: es.directory['rootTransfer.accept.title'],
    });
    expect(api.callsTo('POST', `${TRANSFER_PATH}/accept`)).toHaveLength(0);
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['rootTransfer.accept.confirm'] }),
    );

    expect(await screen.findByText(es.directory['rootTransfer.accepted'])).toBeInTheDocument();
    expect(api.callsTo('POST', `${TRANSFER_PATH}/accept`)).toHaveLength(1);
    expect(await screen.findByText(es.directory['rootTransfer.status.waiting'])).toBeVisible();
    expect(
      screen.queryByRole('button', { name: es.directory['rootTransfer.accept.action'] }),
    ).toBeNull();
  });

  it('does not offer accepting to an Administrator who is not the recipient', async () => {
    setup(ADMIN_VIEWER, openTransfer());
    renderApp(PAGE);
    await pageTitle();

    await screen.findByText(es.directory['rootTransfer.status.pending_acceptance']);
    expect(
      screen.queryByRole('button', { name: es.directory['rootTransfer.accept.action'] }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: es.directory['rootTransfer.cancel.action'] }),
    ).toBeVisible();
  });

  it('cancels only after confirming and then offers a new proposal to the Root', async () => {
    const user = userEvent.setup();
    const api = setup(ROOT_VIEWER, openTransfer(), {
      [`DELETE ${TRANSFER_PATH}`]: noContent(),
    });
    renderApp(PAGE);
    await pageTitle();

    await user.click(
      await screen.findByRole('button', { name: es.directory['rootTransfer.cancel.action'] }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: es.directory['rootTransfer.cancel.title'],
    });
    expect(api.callsTo('DELETE', TRANSFER_PATH)).toHaveLength(0);
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['rootTransfer.cancel.confirm'] }),
    );

    await waitFor(() => {
      expect(api.callsTo('DELETE', TRANSFER_PATH)).toHaveLength(1);
    });
    expect(await screen.findByText(es.directory['rootTransfer.cancelled'])).toBeInTheDocument();
    expect(
      await screen.findByRole('group', { name: es.directory['rootTransfer.propose.legend'] }),
    ).toBeVisible();
  });

  it('treats a 404 on cancel as already cancelled', async () => {
    const user = userEvent.setup();
    setup(ROOT_VIEWER, openTransfer(), {
      [`DELETE ${TRANSFER_PATH}`]: problem(404, 'ROOT_TRANSFER.NOT_FOUND'),
    });
    renderApp(PAGE);
    await pageTitle();

    await user.click(
      await screen.findByRole('button', { name: es.directory['rootTransfer.cancel.action'] }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: es.directory['rootTransfer.cancel.title'],
    });
    await user.click(
      within(dialog).getByRole('button', { name: es.directory['rootTransfer.cancel.confirm'] }),
    );

    expect(
      await screen.findByRole('group', { name: es.directory['rootTransfer.propose.legend'] }),
    ).toBeVisible();
  });

  it('answers as a missing route to anyone below Administrator', async () => {
    const api = setup({ rank: 2 }, null);
    renderApp(PAGE);

    expect(await screen.findByRole('heading', { name: es.errors.NOT_FOUND })).toBeVisible();
    expect(screen.queryByRole('heading', { name: es.directory['rootTransfer.title'] })).toBeNull();
    expect(api.callsTo('GET', TRANSFER_PATH)).toHaveLength(0);
  });
});
