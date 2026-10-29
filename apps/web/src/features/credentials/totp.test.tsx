import type { Account, Credential, CredentialTotp, Permission, ShareLevel } from '@iam/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import {
  announcedStatusTexts,
  chooseRowMenuAction,
  es,
  expectNoSecretsStored,
  field,
  rowMenuItemTexts,
} from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_ID = '44444444-4444-4444-8444-444444444441';
const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';

const LABEL = 'Portal de nómina';
const TOTP_PATH = `/credentials/${CREDENTIAL_ID}/totp`;

// Valores de prueba que NUNCA deben quedar en la caché, el almacenamiento ni la URL.
const SECRET_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SECRET_KEY_AS_PASTED = 'jbsw y3dp ehpk 3pxp-jbsw y3dp ehpk 3pxp';
const SECRET_URI = `otpauth://totp/Acme:ana%40example.com?secret=${SECRET_KEY}&issuer=Acme&algorithm=SHA1&digits=6&period=30`;
const CODE = '482913';
const NEXT_CODE = '705118';
const REASON = 'Pasar el segundo factor a un colaborador externo';

const COUNTDOWN_TOLERANCE_SECONDS = 2;
const HIDE_AFTER_MS = 30_000;

const PERMISSIONS: Permission[] = [
  'credential.create',
  'credential.update',
  'credential.use_totp',
  'credential.export_totp',
];

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

const CREDENTIAL: Credential = {
  id: CREDENTIAL_ID,
  accountId: ACCOUNT_ID,
  label: LABEL,
  kind: 'password',
  lastRotatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const totpFixture = (overrides: Partial<CredentialTotp> = {}): CredentialTotp => ({
  status: 'verified',
  algorithm: 'SHA1',
  digits: 6,
  periodSeconds: 30,
  registeredAt: '2026-03-01T12:00:00.000Z',
  verifiedAt: '2026-03-01T12:05:00.000Z',
  exposed: false,
  ...overrides,
});

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );

const t = es.credentials;
// El segundo factor se elige en el menú "⋯" de la fila (docs/frontend.md §6.2).
const rowMenuName = fill(t['action.rowMenu'], { label: LABEL });
const totpItem = t['action.totp'];
const dialogName = fill(t['totp.title'], { label: LABEL });

/**
 * Rutas del segundo factor con estado propio: registrar deja el factor pendiente, confirmar lo
 * verifica y retirar lo retira, igual que el servidor.
 */
function totpRoutes(initial: CredentialTotp | null) {
  const state: { current: CredentialTotp | null } = { current: initial };
  return {
    state,
    routes: {
      [`GET ${TOTP_PATH}`]: () =>
        state.current === null ? problem(404, 'NOT_FOUND') : jsonResponse(state.current),
      [`POST ${TOTP_PATH}`]: () => {
        state.current = totpFixture({ status: 'pending', verifiedAt: null });
        return jsonResponse(state.current, 201);
      },
      [`POST ${TOTP_PATH}/confirm`]: () => {
        state.current = totpFixture({ status: 'verified' });
        return jsonResponse(state.current);
      },
      [`POST ${TOTP_PATH}/retire`]: () => {
        state.current = totpFixture({ status: 'retired' });
        return jsonResponse(state.current);
      },
    },
  };
}

function setup(
  options: {
    level?: ShareLevel | null;
    permissions?: Permission[];
    extra?: Record<string, Parameters<typeof stubApi>[0][string]>;
  } = {},
) {
  const { level = 'MANAGE', permissions = PERMISSIONS, extra = {} } = options;
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET /accounts/${ACCOUNT_ID}`]: jsonResponse(accountFixture(level)),
    [`GET /accounts/${ACCOUNT_ID}/credentials`]: jsonResponse({ data: [CREDENTIAL] }),
    ...extra,
  });
}

const PAGE = `/accounts/${ACCOUNT_ID}/credentials`;

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('cell', { name: LABEL });
  await chooseRowMenuAction(user, rowMenuName, totpItem);
  return screen.findByRole('dialog', { name: dialogName });
}

function advance(milliseconds: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function secondsShownIn(dialog: HTMLElement): number {
  const timer = within(dialog).getByRole('timer');
  const match = /\d+/.exec(timer.textContent);
  return Number(match?.[0]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('second factor action gating', () => {
  it('is offered with USE and the use_totp permission', async () => {
    const user = userEvent.setup();
    setup({ level: 'USE', extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    await screen.findByRole('cell', { name: LABEL });
    expect(await rowMenuItemTexts(user, rowMenuName)).toContain(totpItem);
  });

  it('is hidden without the permission, even at MANAGE', async () => {
    const user = userEvent.setup();
    setup({ level: 'MANAGE', permissions: ['credential.update'] });
    renderApp(PAGE);
    await screen.findByRole('cell', { name: LABEL });
    expect(await rowMenuItemTexts(user, rowMenuName)).not.toContain(totpItem);
  });

  it('is hidden without access to the account', async () => {
    setup({ level: null });
    renderApp(PAGE);
    await screen.findByRole('cell', { name: LABEL });
    // Sin acceso a la cuenta no hay ninguna acción, así que ni el menú se pinta.
    expect(screen.queryByRole('button', { name: rowMenuName })).toBeNull();
  });

  it('USE only offers the code: no register, retire or export', async () => {
    const user = userEvent.setup();
    setup({ level: 'USE', extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByRole('button', { name: t['totp.code.get'] })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.export.open'] })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: t['totp.retire.open'] })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: t['totp.register.again'] })).toBeNull();
  });

  it('EDIT adds register again and retire, but not export', async () => {
    const user = userEvent.setup();
    setup({ level: 'EDIT', extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(
      await within(dialog).findByRole('button', { name: t['totp.retire.open'] }),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: t['totp.register.again'] })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.export.open'] })).toBeNull();
  });

  it('MANAGE without the export permission cannot export', async () => {
    const user = userEvent.setup();
    setup({
      level: 'MANAGE',
      permissions: ['credential.update', 'credential.use_totp'],
      extra: totpRoutes(totpFixture()).routes,
    });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByRole('button', { name: t['totp.code.get'] });
    expect(within(dialog).queryByRole('button', { name: t['totp.export.open'] })).toBeNull();
  });

  it('a retired factor offers neither code nor export nor retire', async () => {
    const user = userEvent.setup();
    setup({ extra: totpRoutes(totpFixture({ status: 'retired' })).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(t['totp.status.retired'])).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.code.get'] })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: t['totp.export.open'] })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: t['totp.retire.open'] })).toBeNull();
    expect(field(t['totp.register.secret'])).toBeVisible();
  });
});

describe('status', () => {
  it('shows "none" and the registration form when there is no second factor, without violations', async () => {
    const user = userEvent.setup();
    setup({ extra: totpRoutes(null).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(t['totp.status.none'])).toBeVisible();
    expect(field(t['totp.register.secret'])).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.code.get'] })).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('shows pending with the confirmation form', async () => {
    const user = userEvent.setup();
    setup({ extra: totpRoutes(totpFixture({ status: 'pending', verifiedAt: null })).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    expect(field(t['totp.confirm.code'])).toBeVisible();
    expect(within(dialog).getByText(t['totp.notVerified'])).toBeVisible();
  });

  it('shows verified with the exposed badge when the secret was exported', async () => {
    const user = userEvent.setup();
    setup({ extra: totpRoutes(totpFixture({ exposed: true })).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(t['totp.status.verified'])).toBeVisible();
    expect(within(dialog).getByText(t['totp.exposed'])).toBeVisible();
  });

  it('shows a translated error with Retry when the status is denied', async () => {
    const user = userEvent.setup();
    setup({ extra: { [`GET ${TOTP_PATH}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('register by manual key', () => {
  it('builds the otpauth link from a raw key, then asks for the confirmation', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(null);
    const api = setup({ extra: routes });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);

    await user.type(field(t['totp.register.secret']), SECRET_KEY_AS_PASTED);
    await user.type(field(t['totp.register.issuer']), 'Acme');
    await user.type(field(t['totp.register.account']), 'ana@example.com');
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));

    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    expect(field(t['totp.confirm.code'])).toBeVisible();
    expect(api.callsTo('POST', TOTP_PATH)[0]?.body).toEqual({
      otpauthUri: `otpauth://totp/Acme:ana%40example.com?secret=${SECRET_KEY}&issuer=Acme`,
    });
    expect(screen.queryByDisplayValue(SECRET_KEY_AS_PASTED)).toBeNull();
    expect(window.location.href).not.toContain(SECRET_KEY);
    expectNoSecretsStored(queryClient, [SECRET_KEY, SECRET_KEY_AS_PASTED]);
  });

  it('falls back to the credential name as the label when issuer and account are empty', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(null).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);
    await user.type(field(t['totp.register.secret']), SECRET_KEY);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    await within(dialog).findByText(t['totp.status.pending']);
    expect(api.callsTo('POST', TOTP_PATH)[0]?.body).toEqual({
      otpauthUri: `otpauth://totp/${encodeURIComponent(LABEL)}?secret=${SECRET_KEY}`,
    });
  });

  it('sends a pasted otpauth link as it is', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(null).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);
    await user.type(field(t['totp.register.secret']), SECRET_URI);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    await within(dialog).findByText(t['totp.status.pending']);
    expect(api.callsTo('POST', TOTP_PATH)[0]?.body).toEqual({ otpauthUri: SECRET_URI });
  });

  it('rejects an empty field and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(null).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    expect(await within(dialog).findByText(es.errors['CREDENTIAL.TOTP_URI_INVALID'])).toBeVisible();
    expect(field(t['totp.register.secret'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', TOTP_PATH)).toHaveLength(0);
  });

  it('maps a server-side CREDENTIAL.TOTP_URI_INVALID to the key field and keeps the form', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(null);
    setup({
      extra: { ...routes, [`POST ${TOTP_PATH}`]: problem(422, 'CREDENTIAL.TOTP_URI_INVALID') },
    });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);
    await user.type(field(t['totp.register.secret']), 'CORTA');
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    await waitFor(() => {
      expect(field(t['totp.register.secret'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(within(dialog).getByText(es.errors['CREDENTIAL.TOTP_URI_INVALID'])).toBeVisible();
  });

  it('shows the access error in an alert when the server denies the registration', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(null);
    setup({ extra: { ...routes, [`POST ${TOTP_PATH}`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await within(dialog).findByText(t['totp.status.none']);
    await user.type(field(t['totp.register.secret']), SECRET_KEY);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });

  it('registers again over a live factor after warning that the previous one is kept', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.register.again'] }));
    expect(
      within(dialog).getByText(fill(t['totp.register.reRegisterNote'], { days: 30 })),
    ).toBeVisible();
    await user.type(field(t['totp.register.secret']), SECRET_KEY);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', TOTP_PATH)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: t['totp.register.submit'] })).toBeNull();
    });
  });
});

describe('confirm', () => {
  const pending = () => totpFixture({ status: 'pending', verifiedAt: null });

  it('sends the typed code and moves to verified', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(pending()).routes });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.type(await screen.findByLabelText(new RegExp(`^${t['totp.confirm.code']}`)), CODE);
    await user.click(within(dialog).getByRole('button', { name: t['totp.confirm.submit'] }));
    expect(await within(dialog).findByText(t['totp.status.verified'])).toBeVisible();
    expect(api.callsTo('POST', `${TOTP_PATH}/confirm`)[0]?.body).toEqual({ code: CODE });
    expect(within(dialog).queryByRole('button', { name: t['totp.confirm.submit'] })).toBeNull();
    expectNoSecretsStored(queryClient, [CODE]);
  });

  it('rejects a code with the wrong length and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(pending()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.type(await screen.findByLabelText(new RegExp(`^${t['totp.confirm.code']}`)), '123');
    await user.click(within(dialog).getByRole('button', { name: t['totp.confirm.submit'] }));
    expect(
      await within(dialog).findByText(fill(t['totp.confirm.format'], { digits: 6 })),
    ).toBeVisible();
    expect(api.callsTo('POST', `${TOTP_PATH}/confirm`)).toHaveLength(0);
  });

  it('maps CREDENTIAL.TOTP_CODE_INVALID to the code field and stays pending', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(pending());
    setup({
      extra: {
        ...routes,
        [`POST ${TOTP_PATH}/confirm`]: problem(422, 'CREDENTIAL.TOTP_CODE_INVALID'),
      },
    });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    const input = await screen.findByLabelText(new RegExp(`^${t['totp.confirm.code']}`));
    await user.type(input, CODE);
    await user.click(within(dialog).getByRole('button', { name: t['totp.confirm.submit'] }));
    expect(
      await within(dialog).findByText(es.errors['CREDENTIAL.TOTP_CODE_INVALID']),
    ).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(t['totp.status.pending'])).toBeVisible();
  });

  it('only people who can edit see the form; the rest see a notice', async () => {
    const user = userEvent.setup();
    setup({ level: 'USE', extra: totpRoutes(pending()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(t['totp.confirm.pendingReadOnly'])).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.confirm.submit'] })).toBeNull();
  });
});

describe('get a code', () => {
  const codePath = `POST ${TOTP_PATH}/code`;

  async function requestCode(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.code.get'] }));
    return dialog;
  }

  it('shows the code with a countdown, and hides it by itself at expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    const api = setup({
      extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 20 }) },
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await requestCode(user);

    expect(await screen.findByDisplayValue(CODE)).toBeInTheDocument();
    expect(api.callsTo('POST', `${TOTP_PATH}/code`)).toHaveLength(1);
    expect(secondsShownIn(dialog)).toBeGreaterThanOrEqual(20 - COUNTDOWN_TOLERANCE_SECONDS);
    expect(await axeViolations(dialog)).toEqual([]);

    await advance(10_000);
    expect(screen.getByDisplayValue(CODE)).toBeInTheDocument();
    expect(secondsShownIn(dialog)).toBeLessThanOrEqual(10);
    expect(secondsShownIn(dialog)).toBeGreaterThanOrEqual(10 - COUNTDOWN_TOLERANCE_SECONDS);

    await advance(11_000);
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(within(dialog).getByText(t['totp.code.expired'])).toBeVisible();
    expect(window.location.href).not.toContain(CODE);
    expectNoSecretsStored(queryClient, [CODE]);

    // Tras vencer se puede pedir otro.
    expect(within(dialog).getByRole('button', { name: t['totp.code.again'] })).toBeEnabled();
  });

  it('shows the next code when the server sends it and promotes it when the current one expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({
      extra: {
        ...routes,
        [codePath]: jsonResponse({ code: CODE, expiresIn: 3, nextCode: NEXT_CODE }),
      },
    });
    renderApp(PAGE);
    const dialog = await requestCode(user);

    expect(await screen.findByDisplayValue(CODE)).toBeInTheDocument();
    expect(screen.getByDisplayValue(NEXT_CODE)).toBeInTheDocument();
    expect(within(dialog).getByText(t['totp.code.next'])).toBeVisible();

    await advance(4_000);
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(screen.getByDisplayValue(NEXT_CODE)).toBeInTheDocument();
    expect(within(dialog).queryByText(t['totp.code.next'])).toBeNull();
    // El siguiente vale un periodo completo (30 s) desde que venció el actual.
    expect(secondsShownIn(dialog)).toBeGreaterThan(20);

    await advance(HIDE_AFTER_MS);
    expect(screen.queryByDisplayValue(NEXT_CODE)).toBeNull();
  });

  it('copies the code and clears the clipboard after 30 s even if the code already expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 20 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(within(dialog).getByRole('button', { name: t['totp.code.copy'] }));
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(CODE);
    });
    await advance(HIDE_AFTER_MS + 1_000);
    expect(write).toHaveBeenLastCalledWith('');
  });

  it('hides the code right away with "Hide now"', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 25 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);
    await user.click(within(dialog).getByRole('button', { name: t['totp.code.hideNow'] }));
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(within(dialog).getByRole('button', { name: t['totp.code.get'] })).toBeVisible();
  });

  // SENSIBLE (revisión humana): tras obtener el código el foco va a la cuenta regresiva (no al campo
  // del código), es el único anuncio (sin región de estado) y el contador no se anuncia (aria-live off).
  it('moves focus to the silent countdown, with no live region and no code outside the field', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 25 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    const codeField = await screen.findByDisplayValue(CODE);
    const countdown = within(dialog).getByRole('timer');
    await waitFor(() => {
      expect(countdown).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(codeField);
    expect(countdown).toHaveAttribute('aria-live', 'off');
    expect(countdown).not.toHaveTextContent(CODE);
    expect(countdown).not.toHaveAttribute('title');
    expect(countdown).not.toHaveAttribute('aria-label');
    expect(announcedStatusTexts(dialog)).toEqual([]);
  });

  // SENSIBLE (revisión humana): al ocultar el código el foco va al aviso de oculto, que sigue
  // montado, y es el único anuncio (texto fijo, sin región de estado ni alert).
  it('moves focus to the hidden notice when the code is hidden by hand', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 25 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);
    await user.click(within(dialog).getByRole('button', { name: t['totp.code.hideNow'] }));
    const notice = within(dialog).getByText(t['totp.code.status.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(notice).not.toHaveTextContent(CODE);
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  // SENSIBLE (revisión humana): al vencer solo el código sale del DOM y el foco queda en el aviso
  // de «venció», que sigue montado, no en el <body>.
  it('removes the code and keeps focus on the expired notice when it expires by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 5 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);

    await advance(6_000);

    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expect(document.body.textContent).not.toContain(CODE);
    const notice = within(dialog).getByText(t['totp.code.expired']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  // SENSIBLE (revisión humana): si el código vence solo mientras la persona escribe en otro control
  // del diálogo (el motivo del export), el foco NO se mueve al aviso de «venció». Falla si el efecto
  // de foco vuelve a ser incondicional.
  it('does not steal focus from another control of the dialog when the code expires by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 5 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.open'] }));
    const reasonField = field(t['reveal.reason']);
    await user.click(reasonField);
    await user.type(reasonField, 'abc');
    expect(reasonField).toHaveFocus();

    await advance(6_000);

    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    const notice = within(dialog).getByText(t['totp.code.expired']);
    expect(notice).not.toHaveFocus();
    expect(reasonField).toHaveFocus();
    expect(reasonField).toHaveValue('abc');
  });

  // SENSIBLE (revisión humana): con el foco DENTRO del panel en un control que sigue montado (su
  // encabezado), el vencimiento automático sí mueve el foco al aviso. Falla si la regla deja de
  // mirar el contenedor del panel.
  it('moves focus to the expired notice when it was inside the panel on a control that stays mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 5 }) } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    await screen.findByDisplayValue(CODE);
    const heading = within(dialog).getByRole('heading', { name: t['totp.code.heading'] });
    act(() => {
      heading.focus();
    });
    expect(heading).toHaveFocus();

    await advance(6_000);

    const notice = within(dialog).getByText(t['totp.code.expired']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
  });

  // SENSIBLE (revisión humana): tras un error el foco vuelve al encabezado (montado, no el <body>) y
  // el único anuncio es el role="alert" con el mensaje fijo del error.
  it('returns focus to the heading after an error and announces it with the alert only', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
    const heading = within(dialog).getByRole('heading', { name: t['totp.code.heading'] });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it('drops the code when the dialog is closed', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 25 }) } });
    const { queryClient } = renderApp(PAGE);
    await requestCode(user);
    await screen.findByDisplayValue(CODE);
    await user.click(screen.getByRole('button', { name: es.common['dialog.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByDisplayValue(CODE)).toBeNull();
    expectNoSecretsStored(queryClient, [CODE]);
  });

  it('drops the code when the screen unmounts', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: jsonResponse({ code: CODE, expiresIn: 25 }) } });
    const { unmount } = renderApp(PAGE);
    await requestCode(user);
    await screen.findByDisplayValue(CODE);
    unmount();
    expect(document.body.textContent).not.toContain(CODE);
  });

  it('shows the per-minute limit and blocks further attempts', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    const api = setup({
      extra: { ...routes, [codePath]: problem(429, 'CREDENTIAL.TOTP_CODE_LIMIT') },
    });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    expect(
      await within(dialog).findByText(new RegExp(es.errors['CREDENTIAL.TOTP_CODE_LIMIT'])),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: t['totp.code.get'] })).toBeDisabled();
    expect(api.callsTo('POST', `${TOTP_PATH}/code`)).toHaveLength(1);
  });

  it('shows the access error when the server denies the code', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [codePath]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await requestCode(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('export the key', () => {
  const exportPath = `POST ${TOTP_PATH}/export`;
  const exported = { otpauthUri: SECRET_URI, secretKey: SECRET_KEY };

  async function openExport(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.export.open'] }));
    return dialog;
  }

  it('asks for a reason with the critical-event warning and a live counter, without violations', async () => {
    const user = userEvent.setup();
    setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openExport(user);
    expect(within(dialog).getByText(t['totp.export.warning'])).toBeVisible();
    const counter = (length: number) => fill(t['reveal.counter'], { length, max: 500, min: 6 });
    expect(within(dialog).getByText(counter(0))).toBeVisible();
    await user.type(field(t['reveal.reason']), '  abc  ');
    expect(within(dialog).getByText(counter(3))).toBeVisible();
    expect(field(t['reveal.reason'])).toHaveAttribute('maxlength', '500');
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('rejects a reason shorter than 6 characters and sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), 'corto');
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(field(t['reveal.reason'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', `${TOTP_PATH}/export`)).toHaveLength(0);
  });

  it('rejects a reason made only of spaces', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), '          ');
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(api.callsTo('POST', `${TOTP_PATH}/export`)).toHaveLength(0);
  });

  it('maps a server-side CREDENTIAL.REASON_INVALID to the reason field', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: problem(422, 'CREDENTIAL.REASON_INVALID') } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await waitFor(() => {
      expect(field(t['reveal.reason'])).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('shows the re-authentication message when the user cancels the identity check', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    const api = setup({
      extra: { ...routes, [exportPath]: problem(403, 'AUTHZ.REAUTH_REQUIRED') },
    });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    const reauth = await screen.findByRole('dialog', { name: es.common['reauth.title'] });
    await user.click(within(reauth).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(
      await screen.findByText(new RegExp(es.errors['AUTHZ.REAUTH_REQUIRED'])),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', `${TOTP_PATH}/export`)).toHaveLength(1);
  });

  it('shows the key and link for 30 s, marks the factor as exposed and leaves no trace', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const status = totpRoutes(totpFixture());
    const { routes, state } = status;
    const api = setup({
      extra: {
        ...routes,
        [exportPath]: () => {
          state.current = totpFixture({ exposed: true });
          return jsonResponse(exported);
        },
      },
    });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), `  ${REASON}  `);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));

    expect(await screen.findByDisplayValue(SECRET_KEY)).toBeInTheDocument();
    expect(screen.getByDisplayValue(SECRET_URI)).toBeInTheDocument();
    expect(api.callsTo('POST', `${TOTP_PATH}/export`)[0]?.body).toEqual({ reason: REASON });
    expect(await within(dialog).findByText(t['totp.exposed'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);

    await advance(HIDE_AFTER_MS - 5_000);
    expect(screen.getByDisplayValue(SECRET_KEY)).toBeInTheDocument();

    await advance(6_000);
    expect(screen.queryByDisplayValue(SECRET_KEY)).toBeNull();
    expect(screen.queryByDisplayValue(SECRET_URI)).toBeNull();
    expect(within(dialog).getByText(t['totp.export.hidden'])).toBeVisible();
    expect(window.location.href).not.toContain(SECRET_KEY);
    expectNoSecretsStored(queryClient, [SECRET_KEY, SECRET_URI]);
  });

  it('asks for a new reason to export again', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    const api = setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.hideNow'] }));
    expect(screen.queryByDisplayValue(SECRET_KEY)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.again'] }));
    expect(field(t['reveal.reason'])).toHaveValue('');
    expect(api.callsTo('POST', `${TOTP_PATH}/export`)).toHaveLength(1);
  });

  // SENSIBLE (revisión humana): tras exportar el foco va al aviso de ocultado (no a la clave), es el
  // único anuncio (sin región de estado) y ese aviso no contiene la clave ni el enlace.
  it('moves focus to the auto-hide notice, with no live region and no key or link outside the fields', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    const keyField = await screen.findByDisplayValue(SECRET_KEY);
    const autoHide = fill(t['totp.export.autoHide'], { seconds: 30 });
    const notice = within(dialog).getByText((content) => content.startsWith(autoHide));
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(keyField);
    expect(notice).not.toHaveTextContent(SECRET_KEY);
    expect(notice).not.toHaveTextContent(SECRET_URI);
    expect(notice).not.toHaveAttribute('title');
    expect(notice).not.toHaveAttribute('aria-label');
    expect(announcedStatusTexts(dialog)).toEqual([]);
  });

  // SENSIBLE (revisión humana): al ocultar la clave a mano el foco va al aviso de oculto, único
  // anuncio, sin repetirlo en un role="alert" ni en una región de estado.
  it('moves focus to the hidden notice when the key is hidden by hand', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.hideNow'] }));
    const notice = within(dialog).getByText(t['totp.export.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(notice).not.toHaveTextContent(SECRET_KEY);
    expect(notice).not.toHaveTextContent(SECRET_URI);
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  // SENSIBLE (revisión humana): al ocultarse solo a los 30 s la clave y el enlace salen del DOM y el
  // foco queda en el aviso de oculto, no en el <body>.
  it('removes the key and link and keeps focus on the hidden notice when they expire by themselves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);

    await advance(HIDE_AFTER_MS + 1_000);

    expect(screen.queryByDisplayValue(SECRET_KEY)).toBeNull();
    expect(screen.queryByDisplayValue(SECRET_URI)).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET_KEY);
    const notice = within(dialog).getByText(t['totp.export.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  // SENSIBLE (revisión humana): si la clave se oculta sola a los 30 s mientras el foco está en un
  // control ajeno al panel (el botón de pedir código), el foco NO se mueve al aviso de oculto. Falla
  // si el efecto de foco vuelve a ser incondicional.
  it('does not steal focus from another control of the dialog when the key hides by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    const otherPanelButton = within(dialog).getByRole('button', { name: t['totp.code.get'] });
    act(() => {
      otherPanelButton.focus();
    });
    expect(otherPanelButton).toHaveFocus();

    await advance(HIDE_AFTER_MS + 1_000);

    expect(screen.queryByDisplayValue(SECRET_KEY)).toBeNull();
    const notice = within(dialog).getByText(t['totp.export.hidden']);
    expect(notice).not.toHaveFocus();
    expect(otherPanelButton).toHaveFocus();
  });

  // SENSIBLE (revisión humana): con el foco DENTRO del panel en un control que sigue montado (su
  // encabezado), el ocultado automático sí mueve el foco al aviso. Falla si la regla deja de mirar
  // el contenedor del panel.
  it('moves focus to the hidden notice when it was inside the panel on a control that stays mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    const heading = within(dialog).getByRole('heading', { name: t['totp.export.heading'] });
    act(() => {
      heading.focus();
    });
    expect(heading).toHaveFocus();

    await advance(HIDE_AFTER_MS + 1_000);

    const notice = within(dialog).getByText(t['totp.export.hidden']);
    await waitFor(() => {
      expect(notice).toHaveFocus();
    });
  });

  it('copies the key and clears the clipboard after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.copyKey'] }));
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith(SECRET_KEY);
    });
    await advance(HIDE_AFTER_MS + 1_000);
    expect(write).toHaveBeenLastCalledWith('');
  });

  it('drops the key when the dialog is closed', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: jsonResponse(exported) } });
    const { queryClient } = renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    await screen.findByDisplayValue(SECRET_KEY);
    await user.click(screen.getByRole('button', { name: es.common['dialog.close'] }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByDisplayValue(SECRET_KEY)).toBeNull();
    expectNoSecretsStored(queryClient, [SECRET_KEY, SECRET_URI]);
  });

  it('shows the access error when the server denies the export', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [exportPath]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await openExport(user);
    await user.type(field(t['reveal.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['totp.export.submit'] }));
    // El aviso añade el identificador de la petición al texto, por eso se busca por fragmento.
    expect(await within(dialog).findByText(new RegExp(es.errors['AUTHZ.SHARE']))).toBeVisible();
  });
});

describe('retire', () => {
  it('asks for confirmation, retires and offers to register again', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.retire.open'] }));

    const confirm = await screen.findByRole('dialog', {
      name: fill(t['totp.retire.title'], { label: LABEL }),
    });
    expect(api.callsTo('POST', `${TOTP_PATH}/retire`)).toHaveLength(0);
    expect(await axeViolations(confirm)).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: t['totp.retire.confirm'] }));

    expect(await within(dialog).findByText(t['totp.status.retired'])).toBeVisible();
    expect(api.callsTo('POST', `${TOTP_PATH}/retire`)).toHaveLength(1);
    expect(field(t['totp.register.secret'])).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['totp.code.get'] })).toBeNull();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const api = setup({ extra: totpRoutes(totpFixture()).routes });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.retire.open'] }));
    const confirm = await screen.findByRole('dialog', {
      name: fill(t['totp.retire.title'], { label: LABEL }),
    });
    await user.click(within(confirm).getByRole('button', { name: es.common['actions.cancel'] }));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: fill(t['totp.retire.title'], { label: LABEL }) }),
      ).toBeNull();
    });
    expect(api.callsTo('POST', `${TOTP_PATH}/retire`)).toHaveLength(0);
    expect(within(dialog).getByText(t['totp.status.verified'])).toBeVisible();
  });

  it('shows the translated error inside the confirmation when the server denies it', async () => {
    const user = userEvent.setup();
    const { routes } = totpRoutes(totpFixture());
    setup({ extra: { ...routes, [`POST ${TOTP_PATH}/retire`]: problem(403, 'AUTHZ.SHARE') } });
    renderApp(PAGE);
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: t['totp.retire.open'] }));
    const confirm = await screen.findByRole('dialog', {
      name: fill(t['totp.retire.title'], { label: LABEL }),
    });
    await user.click(within(confirm).getByRole('button', { name: t['totp.retire.confirm'] }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(es.errors['AUTHZ.SHARE']);
  });
});

describe('second factor dialog in English', () => {
  it('renders in English too', async () => {
    const user = userEvent.setup();
    const { loadCredentialsCatalog } = await import('@iam/i18n');
    const en = (await loadCredentialsCatalog())['en-US'];
    setup({ extra: totpRoutes(null).routes });
    renderApp(PAGE, 'en-US');
    await screen.findByRole('cell', { name: LABEL });
    await chooseRowMenuAction(
      user,
      fill(en['action.rowMenu'], { label: LABEL }),
      en['action.totp'],
    );
    const dialog = await screen.findByRole('dialog', {
      name: fill(en['totp.title'], { label: LABEL }),
    });
    expect(await within(dialog).findByText(en['totp.status.none'])).toBeVisible();
  });
});
