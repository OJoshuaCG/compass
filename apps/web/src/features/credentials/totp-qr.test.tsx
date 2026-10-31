import type { Account, Credential, CredentialTotp, Permission } from '@iam/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { chooseRowMenuAction, es, expectNoSecretsStored } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

import { buildMigrationUri, type FixtureEntry } from './model/migration-test-fixture';
import type { PixelBuffer } from './model/qr-decoder';
import { renderQrPixels } from './model/qr-test-fixture';

const ACCOUNT_ID = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_ID = '44444444-4444-4444-8444-444444444441';
const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const LABEL = 'Portal de nómina';
const TOTP_PATH = `/credentials/${CREDENTIAL_ID}/totp`;
const PAGE = `/accounts/${ACCOUNT_ID}/credentials`;

// Valores que NUNCA deben quedar en la caché, el almacenamiento, la URL ni el DOM.
const SECRET_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SECRET_URI = `otpauth://totp/Acme:ana%40example.com?secret=${SECRET_KEY}&issuer=Acme`;
// Exportación truncada: no es válida. Sirve para probar el error sin contenido.
const MALFORMED_MIGRATION_URI =
  'otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGAoJYWNtZTpkZW1v';
// Secreto de prueba del RFC 6238 (20 bytes) y su Base32: ni uno ni otro pueden verse en pantalla.
const MIGRATION_SECRET_TEXT = '12345678901234567890';
const MIGRATION_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ANA: FixtureEntry = {
  secretText: MIGRATION_SECRET_TEXT,
  name: 'ana@example.com',
  issuer: 'Acme',
};
const BOB: FixtureEntry = {
  secretText: MIGRATION_SECRET_TEXT,
  name: 'bob@example.com',
  issuer: 'Globex',
};
const HOTP_ENTRY: FixtureEntry = { ...ANA, name: 'counter', type: 1 };
const MD5_ENTRY: FixtureEntry = { ...ANA, name: 'legacy', algorithm: 4 };
const ANA_URI = `otpauth://totp/Acme:ana%40example.com?secret=${MIGRATION_SECRET_BASE32}&issuer=Acme`;
const BOB_URI = `otpauth://totp/Globex:bob%40example.com?secret=${MIGRATION_SECRET_BASE32}&issuer=Globex`;
const FOREIGN_URL = 'https://example.com/private-page';

const PERMISSIONS: Permission[] = ['credential.create', 'credential.update', 'credential.use_totp'];

const t = es.credentials;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    template,
  );
const rowMenuName = fill(t['action.rowMenu'], { label: LABEL });
const dialogName = fill(t['totp.title'], { label: LABEL });

const ACCOUNT: Account = {
  id: ACCOUNT_ID,
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel: 'MANAGE',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const CREDENTIAL: Credential = {
  id: CREDENTIAL_ID,
  accountId: ACCOUNT_ID,
  label: LABEL,
  kind: 'password',
  lastRotatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const pendingTotp: CredentialTotp = {
  status: 'pending',
  algorithm: 'SHA1',
  digits: 6,
  periodSeconds: 30,
  registeredAt: '2026-03-01T12:00:00.000Z',
  verifiedAt: null,
  exposed: false,
};

// El GET devuelve el estado que dejó el POST, como el servidor: si siguiera en 404, la recarga que
// hace el diálogo tras registrar lo mantendría sin factor y nunca mostraría «pendiente».
function setup(registerResponse = jsonResponse(pendingTotp, 201)) {
  const state: { registered: boolean } = { registered: false };
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 1 })),
    [`GET /accounts/${ACCOUNT_ID}`]: jsonResponse(ACCOUNT),
    [`GET /accounts/${ACCOUNT_ID}/credentials`]: jsonResponse({ data: [CREDENTIAL] }),
    [`GET ${TOTP_PATH}`]: () =>
      state.registered ? jsonResponse(pendingTotp) : problem(404, 'NOT_FOUND'),
    [`POST ${TOTP_PATH}`]: () => {
      state.registered = registerResponse.status === 201;
      return registerResponse;
    },
  });
}

// jsdom no trae lienzo: el contexto falso devuelve los píxeles del QR "en pantalla" de cada prueba.
let pixelsOnScreen: PixelBuffer;
const closeBitmap = vi.fn();
const stopTrack = vi.fn();

function installFakeBrowserMedia(options: { displayCapture: boolean }) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: vi.fn(),
    getImageData: () => ({
      data: pixelsOnScreen.data,
      width: pixelsOnScreen.width,
      height: pixelsOnScreen.height,
    }),
  })) as unknown as HTMLCanvasElement['getContext']);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() =>
      Promise.resolve({
        width: pixelsOnScreen.width,
        height: pixelsOnScreen.height,
        close: closeBitmap,
      }),
    ),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockImplementation(
    () => pixelsOnScreen.width,
  );
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockImplementation(
    () => pixelsOnScreen.height,
  );
  if (options.displayCapture) {
    const getDisplayMedia = vi.fn(() =>
      Promise.resolve({ getTracks: () => [{ stop: stopTrack }, { stop: stopTrack }] }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    });
    return getDisplayMedia;
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  return undefined;
}

function qrFile(name = 'qr.png', type = 'image/png') {
  return new File(['pixels'], name, { type });
}

async function openImageMethod(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('cell', { name: LABEL });
  await chooseRowMenuAction(user, rowMenuName, t['action.totp']);
  const dialog = await screen.findByRole('dialog', { name: dialogName });
  await within(dialog).findByText(t['totp.status.none']);
  await user.click(within(dialog).getByRole('tab', { name: t['totp.register.method.image'] }));
  return dialog;
}

beforeEach(() => {
  pixelsOnScreen = renderQrPixels(SECRET_URI);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  closeBitmap.mockClear();
  stopTrack.mockClear();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function expectNothingLeaked(queryClient: Parameters<typeof expectNoSecretsStored>[0]) {
  expectNoSecretsStored(queryClient, [
    SECRET_KEY,
    SECRET_URI,
    MIGRATION_SECRET_TEXT,
    MIGRATION_SECRET_BASE32,
  ]);
  expect(window.location.href).not.toContain(SECRET_KEY);
  expect(document.body.textContent).not.toContain(SECRET_KEY);
  expect(document.body.textContent).not.toContain(MIGRATION_SECRET_BASE32);
  expect(document.body.textContent).not.toContain(MIGRATION_SECRET_TEXT);
  expect(window.location.href).not.toContain(MIGRATION_SECRET_BASE32);
}

describe('register from a QR image: file', () => {
  it('reads the chosen image and sends only the extracted link to the same register endpoint', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    const api = setup();
    const { queryClient } = renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    expect(await within(dialog).findByText(t['totp.register.image.found'])).toBeVisible();
    expect(closeBitmap).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));

    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    const registerCalls = api.callsTo('POST', TOTP_PATH);
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.body).toEqual({ otpauthUri: SECRET_URI });
    // Ninguna petición lleva la imagen: solo el POST JSON del enlace.
    expect(JSON.stringify(registerCalls[0]?.body)).not.toContain('pixels');
    expectNothingLeaked(queryClient);
  });

  it('keeps the submit button disabled until a QR has been read', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
  });

  it('says the QR is not a TOTP link when it holds a website, without echoing it', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    pixelsOnScreen = renderQrPixels(FOREIGN_URL);
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    expect(await within(dialog).findByText(t['totp.register.image.notTotp'])).toBeVisible();
    expect(document.body.textContent).not.toContain('example.com');
  });

  it('says no QR was found on an image without one', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    const side = 120;
    pixelsOnScreen = {
      data: new Uint8ClampedArray(side * side * 4).fill(255),
      width: side,
      height: side,
    };
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    expect(await within(dialog).findByText(t['totp.register.image.noQr'])).toBeVisible();
  });

  it('rejects a file that is not PNG, JPEG or WebP', async () => {
    const user = userEvent.setup({ applyAccept: false });
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile('qr.gif', 'image/gif'));

    expect(await within(dialog).findByText(t['totp.register.image.unsupported'])).toBeVisible();
  });

  it('rejects an image above the pixel limit', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 5000, height: 5000, close: closeBitmap })),
    );
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    const expected = fill(t['totp.register.image.tooLarge'], { maxSide: 4096, maxMegabytes: 10 });
    expect(await within(dialog).findByText(expected)).toBeVisible();
    expect(closeBitmap).toHaveBeenCalledTimes(1);
  });

  it('forgets the read link when the person switches to the manual key', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);
    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());
    await within(dialog).findByText(t['totp.register.image.found']);

    await user.click(within(dialog).getByRole('tab', { name: t['totp.register.method.key'] }));
    await user.click(within(dialog).getByRole('tab', { name: t['totp.register.method.image'] }));

    expect(within(dialog).queryByText(t['totp.register.image.found'])).toBeNull();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
  });

  it('shows the server rejection of the link when the QR is not accepted', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup(problem(422, 'CREDENTIAL.TOTP_URI_INVALID'));
    renderApp(PAGE);
    const dialog = await openImageMethod(user);
    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());
    await within(dialog).findByText(t['totp.register.image.found']);

    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));

    expect(
      await within(dialog).findByText(new RegExp(es.errors['CREDENTIAL.TOTP_URI_INVALID'])),
    ).toBeVisible();
  });

  it('has no accessibility violations in the image method', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: true });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('register from a QR image: Google Authenticator export', () => {
  const migrationT = (key: string) => t[`totp.register.image.migration.${key}` as keyof typeof t];

  async function uploadMigration(entries: readonly FixtureEntry[]) {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    pixelsOnScreen = renderQrPixels(buildMigrationUri(entries));
    const api = setup();
    const { queryClient } = renderApp(PAGE);
    const dialog = await openImageMethod(user);
    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());
    return { user, api, queryClient, dialog };
  }

  // SENSIBLE (revisión humana): comprueba que el secreto importado no llega a DOM, cachés, almacenamiento ni URL.
  it('imports a single TOTP account directly, like a plain QR, and reports what was skipped', async () => {
    const { user, api, queryClient, dialog } = await uploadMigration([ANA, HOTP_ENTRY]);

    // El aviso nombra la cuenta leída para que la persona confirme que es la correcta.
    expect(
      await within(dialog).findByText(
        fill(migrationT('foundAccount'), { label: 'Acme: ana@example.com' }),
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(fill(migrationT('skippedHotp_one'), { count: 1 })),
    ).toBeVisible();
    expect(within(dialog).queryByRole('group', { name: migrationT('legend') })).toBeNull();
    expectNothingLeaked(queryClient);

    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));

    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    const registerCalls = api.callsTo('POST', TOTP_PATH);
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.body).toEqual({ otpauthUri: ANA_URI });
    expectNothingLeaked(queryClient);
  });

  it('names an unlabeled single account with the existing unnamed text', async () => {
    const { dialog } = await uploadMigration([{ ...ANA, name: '', issuer: '' }]);

    expect(
      await within(dialog).findByText(
        fill(migrationT('foundAccount'), { label: fill(migrationT('unnamed'), { position: 1 }) }),
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain(MIGRATION_SECRET_BASE32);
  });

  // SENSIBLE (revisión humana): el selector no muestra secretos y descarta los de las cuentas no elegidas.
  it('lets the person pick one of several accounts and sends only that one', async () => {
    const { user, api, queryClient, dialog } = await uploadMigration([ANA, BOB]);

    const group = await within(dialog).findByRole('group', { name: migrationT('legend') });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    const anaRadio = within(group).getByRole('radio', { name: 'Acme: ana@example.com' });
    const bobRadio = within(group).getByRole('radio', { name: 'Globex: bob@example.com' });
    expect(anaRadio).not.toBeChecked();
    // Nada se entrega hasta confirmar: ni el botón de registro ni la confirmación están listos.
    const confirm = within(dialog).getByRole('button', { name: migrationT('confirm') });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
    expect(document.body.textContent).not.toContain(MIGRATION_SECRET_BASE32);
    expect(document.body.textContent).not.toContain(MIGRATION_SECRET_TEXT);

    await user.click(bobRadio);
    expect(bobRadio).toBeChecked();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
    await user.click(confirm);

    expect(await within(dialog).findByText(t['totp.register.image.found'])).toBeVisible();
    // Elegir descarta las demás cuentas (y con ellas sus secretos) del estado del componente.
    expect(within(dialog).queryByRole('group', { name: migrationT('legend') })).toBeNull();
    expect(within(dialog).queryByText('Acme: ana@example.com')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));

    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    const registerCalls = api.callsTo('POST', TOTP_PATH);
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.body).toEqual({ otpauthUri: BOB_URI });
    expectNothingLeaked(queryClient);
  });

  it('can be cancelled: the accounts are dropped and nothing can be submitted', async () => {
    const { user, api, dialog } = await uploadMigration([ANA, BOB]);
    await within(dialog).findByRole('group', { name: migrationT('legend') });

    await user.click(within(dialog).getByRole('button', { name: migrationT('cancel') }));

    expect(within(dialog).queryByRole('group', { name: migrationT('legend') })).toBeNull();
    expect(within(dialog).queryByText('Globex: bob@example.com')).toBeNull();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
    expect(api.callsTo('POST', TOTP_PATH)).toHaveLength(0);
  });

  it('drops the pending accounts when the person switches to the manual key', async () => {
    const { user, dialog } = await uploadMigration([ANA, BOB]);
    await within(dialog).findByRole('group', { name: migrationT('legend') });

    await user.click(within(dialog).getByRole('tab', { name: t['totp.register.method.key'] }));
    await user.click(within(dialog).getByRole('tab', { name: t['totp.register.method.image'] }));

    expect(within(dialog).queryByRole('group', { name: migrationT('legend') })).toBeNull();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
  });

  it('uses the plural form when several accounts are skipped', async () => {
    const { dialog } = await uploadMigration([ANA, HOTP_ENTRY, HOTP_ENTRY, MD5_ENTRY, MD5_ENTRY]);

    expect(
      await within(dialog).findByText(fill(migrationT('skippedHotp_other'), { count: 2 })),
    ).toBeVisible();
    expect(
      within(dialog).getByText(fill(migrationT('skippedUnsupported_other'), { count: 2 })),
    ).toBeVisible();
  });

  it('says there is nothing to import when every account is skipped', async () => {
    const { dialog, api } = await uploadMigration([HOTP_ENTRY, MD5_ENTRY]);

    expect(await within(dialog).findByText(migrationT('noneImportable'))).toBeVisible();
    expect(
      within(dialog).getByText(fill(migrationT('skippedHotp_one'), { count: 1 })),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
    expect(api.callsTo('POST', TOTP_PATH)).toHaveLength(0);
  });

  // SENSIBLE (revisión humana): el error de una exportación inválida no repite nada de lo decodificado.
  it('shows an error without content when the export is malformed', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    pixelsOnScreen = renderQrPixels(MALFORMED_MIGRATION_URI);
    const api = setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    expect(await within(dialog).findByText(migrationT('invalid'))).toBeVisible();
    expect(document.body.textContent).not.toContain('offline');
    expect(document.body.textContent).not.toContain('CjEK');
    expect(document.body.textContent).not.toContain('Hello');
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
    expect(api.callsTo('POST', TOTP_PATH)).toHaveLength(0);
  });

  // El selector aparece solo: el foco va a su encabezado y se anuncia un mensaje fijo, sin
  // etiquetas de cuentas ni nada derivado de los secretos.
  it('moves focus to the chooser heading and announces a fixed message without account data', async () => {
    const { dialog } = await uploadMigration([ANA, BOB]);

    const heading = await within(dialog).findByRole('heading', { name: migrationT('heading') });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    const announcement = within(dialog).getByText(migrationT('status'));
    expect(announcement).toHaveAttribute('role', 'status');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    for (const forbidden of [
      ANA.name,
      BOB.name,
      'Acme',
      'Globex',
      MIGRATION_SECRET_BASE32,
      MIGRATION_SECRET_TEXT,
    ]) {
      expect(announcement.textContent).not.toContain(forbidden);
    }
    expect(announcement).not.toHaveAttribute('aria-label');
    expect(announcement).not.toHaveAttribute('title');
  });

  // Al confirmar o cancelar el selector se desmonta: el foco debe ir al campo de pegado, no a <body>.
  it('returns focus to the paste field after confirming an account', async () => {
    const { user, dialog } = await uploadMigration([ANA, BOB]);

    await user.click(await within(dialog).findByRole('radio', { name: /Globex/ }));
    await user.click(within(dialog).getByRole('button', { name: migrationT('confirm') }));

    const pasteField = within(dialog).getByRole('textbox', {
      name: t['totp.register.image.pasteLabel'],
    });
    await waitFor(() => {
      expect(pasteField).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it('returns focus to the paste field after cancelling the chooser', async () => {
    const { user, dialog } = await uploadMigration([ANA, BOB]);

    await user.click(await within(dialog).findByRole('button', { name: migrationT('cancel') }));

    const pasteField = within(dialog).getByRole('textbox', {
      name: t['totp.register.image.pasteLabel'],
    });
    await waitFor(() => {
      expect(pasteField).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it('caps the height of the account list and keeps confirm and cancel outside the scroll area', async () => {
    const { dialog } = await uploadMigration([ANA, BOB]);

    const group = await within(dialog).findByRole('group', { name: migrationT('legend') });
    expect(group).toHaveClass('max-h-64', 'overflow-y-auto');
    const confirm = within(dialog).getByRole('button', { name: migrationT('confirm') });
    const cancel = within(dialog).getByRole('button', { name: migrationT('cancel') });
    expect(group).not.toContainElement(confirm);
    expect(group).not.toContainElement(cancel);
  });

  it('has no accessibility violations while choosing an account', async () => {
    const { dialog } = await uploadMigration([ANA, BOB, HOTP_ENTRY]);
    await within(dialog).findByRole('group', { name: migrationT('legend') });

    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('register from a QR image: paste', () => {
  function pasteInto(input: HTMLElement, items: unknown[]) {
    fireEvent.paste(input, { clipboardData: { items } });
  }

  it('reads an image pasted from the clipboard', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    const api = setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    const file = qrFile('clipboard.png');
    pasteInto(screen.getByLabelText(new RegExp(`^${t['totp.register.image.pasteLabel']}`)), [
      { kind: 'file', type: 'image/png', getAsFile: () => file },
    ]);

    expect(await within(dialog).findByText(t['totp.register.image.found'])).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    await waitFor(() => {
      expect(api.callsTo('POST', TOTP_PATH)[0]?.body).toEqual({ otpauthUri: SECRET_URI });
    });
  });

  it('offers the paste field with a name and a description, and discards typed text', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    await openImageMethod(user);

    const pasteField = screen.getByRole('textbox', { name: t['totp.register.image.pasteLabel'] });
    // Editable (no `readonly`) para que el móvil ofrezca "Pegar" al mantener pulsado.
    expect(pasteField).not.toHaveAttribute('readonly');
    expect(pasteField).toHaveAccessibleDescription(t['totp.register.image.pasteHelp']);
    await user.type(pasteField, 'texto que se descarta');
    expect(pasteField).toHaveValue('');
  });

  it('ignores pasted text', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    pasteInto(screen.getByLabelText(new RegExp(`^${t['totp.register.image.pasteLabel']}`)), [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ]);

    expect(within(dialog).queryByText(t['totp.register.image.found'])).toBeNull();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
  });
});

describe('register from a QR image: screen capture', () => {
  it('takes one frame, stops every track, and registers the decoded link', async () => {
    const user = userEvent.setup();
    const getDisplayMedia = installFakeBrowserMedia({ displayCapture: true });
    const api = setup();
    const { queryClient } = renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.click(
      within(dialog).getByRole('button', { name: t['totp.register.image.capture'] }),
    );

    expect(await within(dialog).findByText(t['totp.register.image.found'])).toBeVisible();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole('button', { name: t['totp.register.submit'] }));
    expect(await within(dialog).findByText(t['totp.status.pending'])).toBeVisible();
    expect(api.callsTo('POST', TOTP_PATH)[0]?.body).toEqual({ otpauthUri: SECRET_URI });
    expectNothingLeaked(queryClient);
  });

  it('stops the tracks even when the frame holds no QR', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: true });
    const side = 120;
    pixelsOnScreen = {
      data: new Uint8ClampedArray(side * side * 4).fill(255),
      width: side,
      height: side,
    };
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.click(
      within(dialog).getByRole('button', { name: t['totp.register.image.capture'] }),
    );

    expect(await within(dialog).findByText(t['totp.register.image.noQr'])).toBeVisible();
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it('explains the denial when the person refuses to share', async () => {
    const user = userEvent.setup();
    const getDisplayMedia = installFakeBrowserMedia({ displayCapture: true });
    getDisplayMedia?.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.click(
      within(dialog).getByRole('button', { name: t['totp.register.image.capture'] }),
    );

    expect(await within(dialog).findByText(t['totp.register.image.captureDenied'])).toBeVisible();
    expect(within(dialog).getByRole('button', { name: t['totp.register.submit'] })).toBeDisabled();
  });

  it('reports a failed capture that is not a denial', async () => {
    const user = userEvent.setup();
    const getDisplayMedia = installFakeBrowserMedia({ displayCapture: true });
    getDisplayMedia?.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'));
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    await user.click(
      within(dialog).getByRole('button', { name: t['totp.register.image.capture'] }),
    );

    expect(await within(dialog).findByText(t['totp.register.image.captureFailed'])).toBeVisible();
  });

  it('hides the capture option when the browser has no getDisplayMedia', async () => {
    const user = userEvent.setup();
    installFakeBrowserMedia({ displayCapture: false });
    setup();
    renderApp(PAGE);
    const dialog = await openImageMethod(user);

    expect(
      within(dialog).queryByRole('button', { name: t['totp.register.image.capture'] }),
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: t['totp.register.image.choose'] }),
    ).toBeVisible();
  });
});

describe('register from a QR image in English', () => {
  it('renders the image method in English too', async () => {
    const user = userEvent.setup();
    const { loadCredentialsCatalog } = await import('@iam/i18n');
    const en = (await loadCredentialsCatalog())['en-US'];
    installFakeBrowserMedia({ displayCapture: false });
    setup();
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
    await user.click(
      await within(dialog).findByRole('tab', { name: en['totp.register.method.image'] }),
    );
    expect(within(dialog).getByText(en['totp.register.image.help'])).toBeVisible();
  });

  it('renders the Google Authenticator chooser in English', async () => {
    const user = userEvent.setup();
    const { loadCredentialsCatalog } = await import('@iam/i18n');
    const en = (await loadCredentialsCatalog())['en-US'];
    installFakeBrowserMedia({ displayCapture: false });
    pixelsOnScreen = renderQrPixels(buildMigrationUri([ANA, BOB, HOTP_ENTRY]));
    setup();
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
    await user.click(
      await within(dialog).findByRole('tab', { name: en['totp.register.method.image'] }),
    );
    await user.upload(screen.getByTestId('totp-qr-file-input'), qrFile());

    expect(
      await within(dialog).findByRole('group', {
        name: en['totp.register.image.migration.legend'],
      }),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        fill(en['totp.register.image.migration.skippedHotp_one'], { count: 1 }),
      ),
    ).toBeVisible();
  });
});
