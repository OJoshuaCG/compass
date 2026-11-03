import type { InboundCode, InboundReceipt, InboundViewSummary, Permission } from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];
const tEn = catalogs['en-US'];

const VIEW_ID = '66666666-6666-4666-8666-666666666661';
const OTHER_VIEW_ID = '66666666-6666-4666-8666-666666666662';
const SOURCE_ID = '77777777-7777-4777-8777-777777777771';
const ITEM_ID = '88888888-8888-4888-8888-888888888881';
const OTHER_ITEM_ID = '88888888-8888-4888-8888-888888888882';

// Valores de prueba que NUNCA deben quedar en la caché, el almacenamiento ni la URL.
const CODE = '482913';
const OTHER_CODE = '705118';
const REFRESHED_CODE = '390216';

const COUNTDOWN_TOLERANCE_SECONDS = 2;
const CLIPBOARD_CLEAR_MS = 30_000;

const READER_PERMISSIONS: Permission[] = ['inbound.read_codes'];

const viewFixture = (overrides: Partial<InboundViewSummary> = {}): InboundViewSummary => ({
  id: VIEW_ID,
  name: 'Códigos de GitHub',
  sourceId: SOURCE_ID,
  sourceDisplayName: 'Buzón de accesos',
  channel: 'mail',
  level: 'USE',
  ...overrides,
});

const VIEWS_PATH = '/inbound/views';
const CODES_PATH = `/inbound/views/${VIEW_ID}/codes`;
const HISTORY_PATH = `/inbound/views/${VIEW_ID}/history`;
const VIEW_PAGE = `/inbound/views/${VIEW_ID}`;

/** El vencimiento se calcula al responder, para que el reloj falso y el del servidor coincidan. */
const codeFixture = (itemId: string, code: string, secondsFromNow: number): InboundCode => ({
  itemId,
  code,
  expiresAt: new Date(Date.now() + secondsFromNow * 1000).toISOString(),
});

const codesResponse = (...codes: { itemId: string; code: string; seconds: number }[]) =>
  jsonResponse({ data: codes.map((c) => codeFixture(c.itemId, c.code, c.seconds)) });

const receiptFixture = (
  index: number,
  overrides: Partial<InboundReceipt> = {},
): InboundReceipt => ({
  id: `99999999-9999-4999-8999-99999999999${String(index)}`,
  receivedAt: '2026-11-03T15:00:00.000Z',
  signingDomain: 'github.com',
  templateKind: 'login_code',
  ...overrides,
});

function setup(extra: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: READER_PERMISSIONS, rank: 1 })),
    [`GET ${VIEWS_PATH}`]: jsonResponse({ data: [viewFixture()] }),
    [`GET ${HISTORY_PATH}`]: jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    ...extra,
  });
}

function advance(milliseconds: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function codesRegion(): HTMLElement {
  return screen.getByRole('region', { name: t['codes.heading'] });
}

/** La página carga su catálogo y su ruta en diferido: la región aparece después del primer render. */
function findCodesRegion(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: t['codes.heading'] });
}

function secondsShownIn(timer: HTMLElement): number {
  const match = /\d+/.exec(timer.textContent);
  return Number(match?.[0]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('navigation', () => {
  it('offers the access codes link only with the inbound.read_codes permission', async () => {
    setup();
    renderApp('/');
    const link = await screen.findByRole('link', { name: es.common['nav.inbound'] });
    expect(link).toHaveAttribute('href', '/inbound');
  });

  it('hides the link without the permission', async () => {
    stubApi({ 'GET /me': jsonResponse(meFixture({ permissions: [], rank: 1 })) });
    renderApp('/');
    await screen.findByRole('navigation', { name: es.common['nav.label'] });
    expect(screen.queryByRole('link', { name: es.common['nav.inbound'] })).toBeNull();
  });
});

describe('views list', () => {
  it('renders one row per view with translated channel and level, each linking to its page', async () => {
    setup({
      [`GET ${VIEWS_PATH}`]: jsonResponse({
        data: [
          viewFixture(),
          viewFixture({ id: OTHER_VIEW_ID, name: 'Alertas SMS', channel: 'sms', level: 'MANAGE' }),
        ],
      }),
    });
    renderApp('/inbound');
    const table = await screen.findByRole('table', { name: t.caption });

    const githubRow = within(table).getByRole('row', { name: new RegExp('Códigos de GitHub') });
    expect(within(githubRow).getByText('Buzón de accesos')).toBeVisible();
    expect(within(githubRow).getByText(t['channel.mail'])).toBeVisible();
    expect(within(githubRow).getByText(t['level.USE'])).toBeVisible();
    expect(within(githubRow).getByRole('link', { name: 'Códigos de GitHub' })).toHaveAttribute(
      'href',
      VIEW_PAGE,
    );

    const smsRow = within(table).getByRole('row', { name: new RegExp('Alertas SMS') });
    expect(within(smsRow).getByText(t['channel.sms'])).toBeVisible();
    expect(within(smsRow).getByText(t['level.MANAGE'])).toBeVisible();
    expect(within(smsRow).getByRole('link', { name: 'Alertas SMS' })).toHaveAttribute(
      'href',
      `/inbound/views/${OTHER_VIEW_ID}`,
    );
    expect(await axeViolations(table)).toEqual([]);
  });

  it('shows the empty state when the person can read no views', async () => {
    setup({ [`GET ${VIEWS_PATH}`]: jsonResponse({ data: [] }) });
    renderApp('/inbound');
    expect(await screen.findByText(t['empty.title'])).toBeVisible();
    expect(screen.getByText(t['empty.description'])).toBeVisible();
  });

  it('shows a translated error with Retry when the list fails', async () => {
    setup({ [`GET ${VIEWS_PATH}`]: problem(403, 'AUTHZ.SHARE') });
    renderApp('/inbound');
    expect(await screen.findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
    expect(screen.getByRole('button', { name: es.common['actions.retry'] })).toBeVisible();
  });
});

describe('codes panel', () => {
  it('shows the code with a visible countdown and hides it by itself at expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = setup({
      [`GET ${CODES_PATH}`]: () => codesResponse({ itemId: ITEM_ID, code: CODE, seconds: 20 }),
    });
    const { queryClient } = renderApp(VIEW_PAGE);

    expect(await screen.findByDisplayValue(CODE)).toBeInTheDocument();
    // Un solo pedido al abrir, aunque los efectos corran dos veces en desarrollo.
    expect(api.callsTo('GET', CODES_PATH)).toHaveLength(1);
    const region = codesRegion();
    const timer = within(region).getByRole('timer');
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(secondsShownIn(timer)).toBeGreaterThanOrEqual(20 - COUNTDOWN_TOLERANCE_SECONDS);
    expect(secondsShownIn(timer)).toBeLessThanOrEqual(20);
    expect(await axeViolations(region)).toEqual([]);

    await advance(10_000);
    expect(screen.getByDisplayValue(CODE)).toBeInTheDocument();
    expect(secondsShownIn(within(region).getByRole('timer'))).toBeLessThanOrEqual(10);

    await advance(11_000);
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(within(region).getByText(t['codes.expired'].replace('{{position}}', '1'))).toBeVisible();
    expect(within(region).queryByRole('timer')).toBeNull();
    // Un código vencido ya no se puede copiar.
    expect(within(region).queryByRole('button', { name: /^Copiar código/ })).toBeNull();
    expectNoSecretsStored(queryClient, [CODE]);
  });

  it('marks only the expired code and keeps the other one valid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({
      [`GET ${CODES_PATH}`]: () =>
        codesResponse(
          { itemId: ITEM_ID, code: CODE, seconds: 3 },
          { itemId: OTHER_ITEM_ID, code: OTHER_CODE, seconds: 60 },
        ),
    });
    renderApp(VIEW_PAGE);
    await screen.findByDisplayValue(CODE);
    expect(screen.getByDisplayValue(OTHER_CODE)).toBeInTheDocument();

    await advance(4_000);
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(screen.getByDisplayValue(OTHER_CODE)).toBeInTheDocument();
    expect(within(codesRegion()).getAllByRole('timer')).toHaveLength(1);
  });

  it('does not show a code that arrives already expired as valid', async () => {
    setup({
      [`GET ${CODES_PATH}`]: () => codesResponse({ itemId: ITEM_ID, code: CODE, seconds: -5 }),
    });
    renderApp(VIEW_PAGE);
    expect(await screen.findByText(t['codes.expired'].replace('{{position}}', '1'))).toBeVisible();
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
  });

  it('shows the empty state when there are no current codes', async () => {
    setup({ [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }) });
    renderApp(VIEW_PAGE);
    expect(await screen.findByText(t['codes.empty.title'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['codes.refresh'] })).toBeEnabled();
  });

  it('refreshes by hand and replaces the previous code', async () => {
    const user = userEvent.setup();
    let call = 0;
    const api = setup({
      [`GET ${CODES_PATH}`]: () => {
        call += 1;
        return codesResponse({
          itemId: ITEM_ID,
          code: call === 1 ? CODE : REFRESHED_CODE,
          seconds: 60,
        });
      },
    });
    renderApp(VIEW_PAGE);
    await screen.findByDisplayValue(CODE);

    await user.click(screen.getByRole('button', { name: t['codes.refresh'] }));

    expect(await screen.findByDisplayValue(REFRESHED_CODE)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(api.callsTo('GET', CODES_PATH)).toHaveLength(2);
  });

  it('copies the code and clears the clipboard after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    setup({
      [`GET ${CODES_PATH}`]: () => codesResponse({ itemId: ITEM_ID, code: CODE, seconds: 120 }),
    });
    renderApp(VIEW_PAGE);
    await screen.findByDisplayValue(CODE);

    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(
      within(codesRegion()).getByRole('button', {
        name: t['codes.copy'].replace('{{position}}', '1'),
      }),
    );
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(CODE);
    });
    await advance(CLIPBOARD_CLEAR_MS + 1_000);
    expect(write).toHaveBeenLastCalledWith('');
  });

  it('shows the not-found error for an unknown view, with no refresh button', async () => {
    setup({ [`GET ${CODES_PATH}`]: problem(404, 'NOT_FOUND') });
    renderApp(VIEW_PAGE);
    const region = await findCodesRegion();
    expect(await within(region).findByRole('alert')).toHaveTextContent(es.errors.NOT_FOUND);
    expect(within(region).queryByRole('button', { name: t['codes.refresh'] })).toBeNull();
    expect(within(region).queryByRole('textbox')).toBeNull();
  });

  it('shows the share error when access was revoked', async () => {
    setup({ [`GET ${CODES_PATH}`]: problem(403, 'AUTHZ.SHARE') });
    renderApp(VIEW_PAGE);
    expect(await within(await findCodesRegion()).findByRole('alert')).toHaveTextContent(
      es.errors['AUTHZ.SHARE'],
    );
  });

  // SENSIBLE (revisión humana): el valor del código solo puede vivir en el estado del componente.
  it('keeps the code out of the Query cache, web storage and the URL', async () => {
    const user = userEvent.setup();
    let call = 0;
    setup({
      [`GET ${CODES_PATH}`]: () => {
        call += 1;
        return codesResponse({
          itemId: ITEM_ID,
          code: call === 1 ? CODE : REFRESHED_CODE,
          seconds: 60,
        });
      },
    });
    const { queryClient, router } = renderApp(VIEW_PAGE);
    await screen.findByDisplayValue(CODE);
    await user.click(screen.getByRole('button', { name: t['codes.refresh'] }));
    await screen.findByDisplayValue(REFRESHED_CODE);

    expectNoSecretsStored(queryClient, [CODE, REFRESHED_CODE]);
    const cachedKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    expect(cachedKeys.some((key) => key.includes('codes'))).toBe(false);
    expect(window.location.href).not.toContain(CODE);
    expect(router.state.location.href).not.toContain(CODE);
    expect(router.state.location.href).not.toContain(REFRESHED_CODE);
  });
});

describe('history', () => {
  it('paginates by cursor: next page, then back', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${HISTORY_PATH}`]: (call) =>
        call.search.get('cursor') === 'cursor-2'
          ? jsonResponse({
              data: [receiptFixture(3, { signingDomain: 'microsoft.com' })],
              page: { nextCursor: null, limit: 25 },
            })
          : jsonResponse({
              data: [
                receiptFixture(1, { signingDomain: 'github.com' }),
                receiptFixture(2, { signingDomain: null, templateKind: 'reset_link' }),
              ],
              page: { nextCursor: 'cursor-2', limit: 25 },
            }),
      [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }),
    });
    renderApp(VIEW_PAGE);
    const table = await screen.findByRole('table', { name: t['history.caption'] });

    expect(await within(table).findByText('github.com')).toBeVisible();
    expect(within(table).getByText(t['history.domain.unknown'])).toBeVisible();
    expect(within(table).getByText(t['templateKind.login_code'])).toBeVisible();
    expect(within(table).getByText(t['templateKind.reset_link'])).toBeVisible();
    // El historial no lleva valores: solo fecha, tipo y dominio.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: es.common['table.next'] }));
    expect(await within(table).findByText('microsoft.com')).toBeVisible();
    expect(within(table).queryByText('github.com')).toBeNull();
    expect(
      api.callsTo('GET', HISTORY_PATH).some((call) => call.search.get('cursor') === 'cursor-2'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: es.common['table.next'] })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: es.common['table.previous'] }));
    expect(await within(table).findByText('github.com')).toBeVisible();
  });

  it('shows the empty state when the view has no receipts', async () => {
    setup({ [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }) });
    renderApp(VIEW_PAGE);
    expect(await screen.findByText(t['history.empty.title'])).toBeVisible();
  });
});

describe('view page structure', () => {
  it('has a heading per part and uses the view name as the page title', async () => {
    setup({ [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }) });
    renderApp(VIEW_PAGE);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Códigos de GitHub' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: t['codes.heading'] })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: t['history.heading'] })).toBeVisible();
    expect(screen.getByRole('link', { name: t.back })).toHaveAttribute('href', '/inbound');
  });

  it('renders the same screens in English', async () => {
    setup({
      [`GET ${CODES_PATH}`]: () => codesResponse({ itemId: ITEM_ID, code: CODE, seconds: 60 }),
    });
    renderApp(VIEW_PAGE, 'en-US');
    expect(
      await screen.findByRole('heading', { level: 2, name: tEn['codes.heading'] }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: tEn['history.heading'] })).toBeVisible();
    expect(await screen.findByDisplayValue(CODE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tEn['codes.refresh'] })).toBeVisible();
  });

  it('answers an id that is not a UUID as an unknown route, without calling the codes API', async () => {
    const api = setup();
    renderApp('/inbound/views/not-a-uuid');
    await screen.findByRole('navigation', { name: es.common['nav.label'] });
    expect(api.calls.some((call) => call.path.includes('/codes'))).toBe(false);
  });
});
