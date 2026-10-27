import type { SessionSummary } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const CURRENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GHOST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const session = (overrides: Partial<SessionSummary>): SessionSummary => ({
  id: CURRENT_ID,
  createdAt: '2030-01-01T10:00:00.000Z',
  lastSeenAt: '2030-01-01T11:00:00.000Z',
  expiresAt: '2030-01-02T10:00:00.000Z',
  userAgent: null,
  ip: null,
  current: false,
  ...overrides,
});

const LAPTOP = session({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36',
  ip: '203.0.113.7',
  current: true,
});
const PHONE = session({
  id: PHONE_ID,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36',
  ip: '198.51.100.20',
});
const UNKNOWN = session({ id: GHOST_ID });

const listOf = (...sessions: SessionSummary[]) => jsonResponse({ data: sessions });
const mine = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/me/sessions');
const closeLabel = (device: string) =>
  es.sessions['action.closeLabel'].replace('{{device}}', device);

/** La tabla se pinta ya en su estado de carga: se espera a que lleguen las filas. */
const rowsLoaded = () => screen.findByText('Chrome · Linux');

function setup(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture()),
    'GET /me/sessions': listOf(LAPTOP, PHONE, UNKNOWN),
    ...extra,
  });
}

describe('my sessions screen', () => {
  it('lists the own sessions with device, IP, dates and the current badge, without accessibility violations', async () => {
    setup();
    const { container } = renderApp('/sessions');
    await rowsLoaded();
    const table = screen.getByRole('table', { name: es.sessions.caption });
    expect(screen.getByRole('heading', { level: 1, name: es.sessions.title })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // encabezado + 3
    expect(within(rows[1] as HTMLElement).getByText('Chrome · Linux')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('203.0.113.7')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(es.sessions['badge.current']),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Chrome · Android')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).queryByText(es.sessions['badge.current'])).toBeNull();
    // Sin User-Agent ni IP: textos de respaldo, nunca celdas vacías ni "null".
    expect(within(rows[3] as HTMLElement).getByText(es.sessions['device.unknown'])).toBeVisible();
    expect(within(rows[3] as HTMLElement).getByText(es.sessions['ip.unknown'])).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers Close for other sessions but never for the current one', async () => {
    setup();
    renderApp('/sessions');
    await rowsLoaded();
    expect(screen.getAllByRole('button', { name: /^Cerrar la sesión de/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: closeLabel('Chrome · Android') })).toBeVisible();
    expect(screen.queryByRole('button', { name: closeLabel('Chrome · Linux') })).toBeNull();
  });

  it('is reachable from the navigation', async () => {
    setup();
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: es.common['nav.sessions'] }));
    await rowsLoaded();
    expect(router.state.location.pathname).toBe('/sessions');
  });

  it('asks for confirmation, revokes only that session and refetches the list', async () => {
    const user = userEvent.setup();
    let revoked = false;
    const api = setup({
      'GET /me/sessions': () => listOf(LAPTOP, ...(revoked ? [] : [PHONE])),
      [`POST /me/sessions/${PHONE_ID}/revoke`]: () => {
        revoked = true;
        return noContent();
      },
    });
    renderApp('/sessions');
    await user.click(await screen.findByRole('button', { name: closeLabel('Chrome · Android') }));
    const dialog = await screen.findByRole('dialog', { name: es.sessions['close.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    // Todavía no se cerró nada.
    expect(api.callsTo('POST', `/me/sessions/${PHONE_ID}/revoke`)).toHaveLength(0);
    const before = mine(api).length;

    await user.click(within(dialog).getByRole('button', { name: es.sessions['close.confirm'] }));

    expect(await screen.findByText(es.sessions['close.toast'])).toBeInTheDocument();
    const call = api.callsTo('POST', `/me/sessions/${PHONE_ID}/revoke`)[0];
    expect(call?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    await waitFor(() => {
      expect(mine(api).length).toBeGreaterThan(before);
      expect(screen.queryByRole('button', { name: closeLabel('Chrome · Android') })).toBeNull();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the dialog sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /me/sessions/${PHONE_ID}/revoke`]: noContent() });
    renderApp('/sessions');
    await user.click(await screen.findByRole('button', { name: closeLabel('Chrome · Android') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.callsTo('POST', `/me/sessions/${PHONE_ID}/revoke`)).toHaveLength(0);
  });

  it('treats a 404 (already gone) as closed and refreshes the list', async () => {
    const user = userEvent.setup();
    const api = setup({ [`POST /me/sessions/${PHONE_ID}/revoke`]: problem(404, 'NOT_FOUND') });
    renderApp('/sessions');
    await user.click(await screen.findByRole('button', { name: closeLabel('Chrome · Android') }));
    const dialog = await screen.findByRole('dialog');
    const before = mine(api).length;
    await user.click(within(dialog).getByRole('button', { name: es.sessions['close.confirm'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mine(api).length).toBeGreaterThan(before);
    });
  });

  it('shows another server error inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    setup({ [`POST /me/sessions/${PHONE_ID}/revoke`]: problem(422, 'VALIDATION.FAILED') });
    renderApp('/sessions');
    await user.click(await screen.findByRole('button', { name: closeLabel('Chrome · Android') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.sessions['close.confirm'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['VALIDATION.FAILED'],
    );
  });

  it('shows the loading state and then an empty state', async () => {
    setup({ 'GET /me/sessions': listOf() });
    renderApp('/sessions');
    expect(await screen.findByText(es.sessions['empty.title'])).toBeInTheDocument();
  });

  it('shows a translated error with Retry, and retry reloads', async () => {
    const user = userEvent.setup();
    let fail = true;
    const api = setup({
      'GET /me/sessions': () => (fail ? problem(500, 'INTERNAL') : listOf(LAPTOP)),
    });
    renderApp('/sessions');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(es.errors.INTERNAL);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: es.common['actions.retry'] }));
    await screen.findByText('Chrome · Linux');
    expect(mine(api).length).toBeGreaterThan(1);
  });

  it('renders in English too', async () => {
    const { loadSessionsCatalog } = await import('@iam/i18n');
    const en = (await loadSessionsCatalog())['en-US'];
    setup();
    renderApp('/sessions', 'en-US');
    expect(await screen.findByRole('table', { name: en.caption })).toBeInTheDocument();
    await rowsLoaded();
    expect(screen.getByText(en['badge.current'])).toBeInTheDocument();
  });
});
