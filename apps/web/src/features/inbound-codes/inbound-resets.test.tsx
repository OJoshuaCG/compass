import type { InboundReset, InboundViewSummary, Permission } from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];

const VIEW_ID = '66666666-6666-4666-8666-666666666661';
const SOURCE_ID = '77777777-7777-4777-8777-777777777771';
const CODE_ITEM_ID = '88888888-8888-4888-8888-888888888881';
const LINK_ITEM_ID = '88888888-8888-4888-8888-888888888882';

// Valores de prueba que NUNCA deben quedar en la caché, el almacenamiento ni la URL.
const RESET_CODE = '917204';
const RESET_LINK = 'https://example.test/reset?token=s3cr3t-token-value';

const VALID_REASON = 'Soporte pidió recuperar la cuenta';
const AUTO_HIDE_MS = 30_000;

const MANAGER_PERMISSIONS: Permission[] = ['inbound.read_codes', 'inbound.reveal_reset'];

const VIEWS_PATH = '/inbound/views';
const CODES_PATH = `/inbound/views/${VIEW_ID}/codes`;
const HISTORY_PATH = `/inbound/views/${VIEW_ID}/history`;
const REVEAL_PATH = `/inbound/views/${VIEW_ID}/resets/reveal`;
const VIEW_PAGE = `/inbound/views/${VIEW_ID}`;

const viewFixture = (overrides: Partial<InboundViewSummary> = {}): InboundViewSummary => ({
  id: VIEW_ID,
  name: 'Restablecimientos de GitHub',
  sourceId: SOURCE_ID,
  sourceDisplayName: 'Buzón de accesos',
  channel: 'mail',
  level: 'MANAGE',
  ...overrides,
});

const resetsFixture = (): InboundReset[] => [
  {
    itemId: CODE_ITEM_ID,
    kind: 'reset_code',
    valueType: 'code',
    value: RESET_CODE,
    expiresAt: '2026-11-03T16:00:00.000Z',
  },
  {
    itemId: LINK_ITEM_ID,
    kind: 'reset_link',
    valueType: 'link',
    value: RESET_LINK,
    expiresAt: '2026-11-03T16:10:00.000Z',
  },
];

type SetupOptions = {
  permissions?: Permission[];
  view?: Partial<InboundViewSummary>;
  reveal?: Parameters<typeof stubApi>[0][string];
};

function setup({ permissions = MANAGER_PERMISSIONS, view = {}, reveal }: SetupOptions = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET ${VIEWS_PATH}`]: jsonResponse({ data: [viewFixture(view)] }),
    [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }),
    [`GET ${HISTORY_PATH}`]: jsonResponse({ data: [], page: { nextCursor: null, limit: 25 } }),
    ...(reveal === undefined ? {} : { [`POST ${REVEAL_PATH}`]: reveal }),
  });
}

function resetsRegion(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: t['resets.heading'] });
}

/** Espera a que la página esté lista (la región de códigos se pinta siempre) antes de afirmar ausencias. */
async function waitForViewPage(): Promise<void> {
  await screen.findByRole('region', { name: t['codes.heading'] });
  await screen.findByRole('heading', { name: 'Restablecimientos de GitHub' });
}

async function openReasonForm(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const region = await resetsRegion();
  await user.click(within(region).getByRole('button', { name: t['resets.open'] }));
  return region;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('reset reveal panel visibility', () => {
  it('is offered with the inbound.reveal_reset permission and MANAGE on the view', async () => {
    setup();
    renderApp(VIEW_PAGE);
    const region = await resetsRegion();
    expect(within(region).getByText(t['resets.description'])).toBeVisible();
    expect(await axeViolations(region)).toEqual([]);
  });

  it('is not offered with a level below MANAGE, even with the permission', async () => {
    setup({ view: { level: 'EDIT' } });
    renderApp(VIEW_PAGE);
    await waitForViewPage();
    expect(screen.queryByRole('region', { name: t['resets.heading'] })).toBeNull();
  });

  it('is not offered without the inbound.reveal_reset permission, even with MANAGE', async () => {
    setup({ permissions: ['inbound.read_codes'] });
    renderApp(VIEW_PAGE);
    await waitForViewPage();
    expect(screen.queryByRole('region', { name: t['resets.heading'] })).toBeNull();
  });
});

describe('reset reveal reason', () => {
  it('rejects a short reason in the browser and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ reveal: jsonResponse({ data: resetsFixture() }) });
    renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), '  abc  ');
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));

    expect(within(region).getByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(api.callsTo('POST', REVEAL_PATH)).toHaveLength(0);
  });

  it('shows the server rejection of the reason on the field', async () => {
    const user = userEvent.setup();
    setup({ reveal: problem(400, 'CREDENTIAL.REASON_INVALID') });
    renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), VALID_REASON);
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));

    expect(await within(region).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    // Va en el campo y no se repite en un aviso general.
    expect(within(region).getAllByText(es.errors['CREDENTIAL.REASON_INVALID'])).toHaveLength(1);

    // Al corregir el motivo, el rechazo anterior del servidor deja de mostrarse.
    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), ' de nuevo');
    expect(within(region).queryByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeNull();
  });

  it('shows a translated error and reveals nothing when the server denies the reveal', async () => {
    const user = userEvent.setup();
    setup({ reveal: problem(403, 'AUTHZ.SHARE') });
    renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), VALID_REASON);
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));

    expect(await within(region).findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
    expect(screen.queryByDisplayValue(RESET_CODE)).toBeNull();
  });
});

describe('revealed resets', () => {
  it('sends the trimmed reason, shows each value masked and never as a link, and hides them at 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const api = setup({ reveal: jsonResponse({ data: resetsFixture() }) });
    const { queryClient } = renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(
      within(region).getByRole('textbox', { name: /Motivo/ }),
      `  ${VALID_REASON}  `,
    );
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));

    const codeField = await within(region).findByDisplayValue(RESET_CODE);
    const linkField = within(region).getByDisplayValue(RESET_LINK);
    expect(api.callsTo('POST', REVEAL_PATH)).toHaveLength(1);
    expect(api.callsTo('POST', REVEAL_PATH)[0]?.body).toEqual({ reason: VALID_REASON });
    // Enmascarados por omisión, como una contraseña revelada.
    expect(codeField).toHaveAttribute('type', 'password');
    expect(linkField).toHaveAttribute('type', 'password');
    // El enlace nunca es un ancla navegable.
    expect(within(region).queryByRole('link')).toBeNull();
    expect(
      within(region).getByRole('button', { name: t['resets.copy'].replace('{{position}}', '2') }),
    ).toBeVisible();
    expect(await axeViolations(region)).toEqual([]);
    expectNoSecretsStored(queryClient, [RESET_CODE, RESET_LINK]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_HIDE_MS - 1_000);
    });
    // Siguen visibles justo antes del plazo: un temporizador más corto no pasaría.
    expect(within(region).getByDisplayValue(RESET_CODE)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(within(region).queryByDisplayValue(RESET_CODE)).toBeNull();
    expect(within(region).queryByDisplayValue(RESET_LINK)).toBeNull();
    expect(within(region).getByText(t['resets.hidden'])).toBeVisible();
    expect(within(region).getByRole('button', { name: t['resets.again'] })).toBeVisible();
    expectNoSecretsStored(queryClient, [RESET_CODE, RESET_LINK]);
  });

  it('hides the values at once with Hide now', async () => {
    const user = userEvent.setup();
    setup({ reveal: jsonResponse({ data: resetsFixture() }) });
    renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), VALID_REASON);
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));
    await within(region).findByDisplayValue(RESET_CODE);

    await user.click(within(region).getByRole('button', { name: t['resets.hideNow'] }));
    expect(within(region).queryByDisplayValue(RESET_CODE)).toBeNull();
    expect(within(region).getByText(t['resets.hidden'])).toHaveFocus();
  });

  it('says so when there is nothing live to reveal', async () => {
    const user = userEvent.setup();
    setup({ reveal: jsonResponse({ data: [] }) });
    renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), VALID_REASON);
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));

    expect(await within(region).findByText(t['resets.none'])).toHaveFocus();

    // Cerrar vuelve al inicio: no se dice «se ocultaron» porque no se reveló nada.
    await user.click(within(region).getByRole('button', { name: t['resets.close'] }));
    expect(within(region).getByText(t['resets.description'])).toBeVisible();
    expect(within(region).queryByText(t['resets.hidden'])).toBeNull();
  });

  it('never shows the values when the person cancels while the reveal is in flight', async () => {
    const user = userEvent.setup();
    let respond: (response: Response) => void = () => undefined;
    const pendingReveal = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    const api = setup({ reveal: () => pendingReveal });
    const { queryClient } = renderApp(VIEW_PAGE);
    const region = await openReasonForm(user);

    await user.type(within(region).getByRole('textbox', { name: /Motivo/ }), VALID_REASON);
    await user.click(within(region).getByRole('button', { name: t['resets.submit'] }));
    expect(api.callsTo('POST', REVEAL_PATH)).toHaveLength(1);
    await user.click(within(region).getByRole('button', { name: es.common['actions.cancel'] }));

    await act(async () => {
      respond(jsonResponse({ data: resetsFixture() }));
      await pendingReveal;
    });
    expect(within(region).getByText(t['resets.description'])).toBeVisible();
    expect(screen.queryByDisplayValue(RESET_CODE)).toBeNull();
    expect(screen.queryByDisplayValue(RESET_LINK)).toBeNull();
    expectNoSecretsStored(queryClient, [RESET_CODE, RESET_LINK]);
  });
});
