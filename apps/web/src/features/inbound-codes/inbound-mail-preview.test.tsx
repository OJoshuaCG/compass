import type { InboundViewSummary, Permission } from '@iam/contracts';
import { INBOUND_MAIL_PREVIEW_FAILURE_CODES } from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

// Consulta rápida y tope corto: la prueba de «tarda más de lo esperado» no espera minutos reales.
vi.mock('./model/inbound-mail-preview-policy', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    MAIL_PREVIEW_POLL_INTERVAL_MS: 5,
    MAIL_PREVIEW_POLL_MAX_ATTEMPTS: 3,
  };
});

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];
const tEn = catalogs['en-US'];

const VIEW_ID = '66666666-6666-4666-8666-666666666661';
const SOURCE_ID = '77777777-7777-4777-8777-777777777771';
const RECEIPT_ID = '99999999-9999-4999-8999-999999999991';
const OTHER_RECEIPT_ID = '99999999-9999-4999-8999-999999999992';

const VIEWS_PATH = '/inbound/views';
const CODES_PATH = `/inbound/views/${VIEW_ID}/codes`;
const HISTORY_PATH = `/inbound/views/${VIEW_ID}/history`;
const PREVIEW_PATH = `/inbound/receipts/${RECEIPT_ID}/mail-preview`;
const VIEW_PAGE = `/inbound/views/${VIEW_ID}`;

const SUBJECT = 'Tu código de acceso de GitHub';
const BODY = 'Hola,\nTu código es 123456.\nSaludos';
const REASON = 'Necesito confirmar el remitente';

const PREVIEWER_PERMISSIONS: Permission[] = ['inbound.read_codes', 'inbound.delete_mail'];
const BODY_PERMISSIONS: Permission[] = [...PREVIEWER_PERMISSIONS, 'inbound.reveal_reset'];

type Handler = Parameters<typeof stubApi>[0][string];
type KindHandlers = { post?: Handler; get?: Handler; read?: Handler };

const readyStatus = jsonResponse({
  data: { status: 'ready', resultCode: null, requestedAt: '2026-11-14T10:00:00.000Z' },
});
const pendingStatus = jsonResponse({
  data: { status: 'pending', resultCode: null, requestedAt: '2026-11-14T10:00:00.000Z' },
});
const failedStatus = (resultCode: string) =>
  jsonResponse({
    data: { status: 'failed', resultCode, requestedAt: '2026-11-14T10:00:00.000Z' },
  });

function kindRoutes(kind: 'subject' | 'body', content: string, handlers: KindHandlers) {
  return {
    [`POST ${PREVIEW_PATH}/${kind}`]:
      handlers.post ?? jsonResponse({ status: 'pending', alreadyPending: false }, 202),
    [`GET ${PREVIEW_PATH}/${kind}`]: handlers.get ?? readyStatus,
    [`POST ${PREVIEW_PATH}/${kind}/read`]:
      handlers.read ?? jsonResponse({ data: { kind, content } }),
  };
}

type SetupOptions = {
  permissions?: Permission[];
  level?: InboundViewSummary['level'];
  subjectContent?: string;
  bodyContent?: string;
  subject?: KindHandlers;
  body?: KindHandlers;
};

function setup({
  permissions = BODY_PERMISSIONS,
  level = 'MANAGE',
  subjectContent = SUBJECT,
  bodyContent = BODY,
  subject = {},
  body = {},
}: SetupOptions = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions, rank: 1 })),
    [`GET ${VIEWS_PATH}`]: jsonResponse({
      data: [
        {
          id: VIEW_ID,
          name: 'Códigos de GitHub',
          sourceId: SOURCE_ID,
          sourceDisplayName: 'Buzón de accesos',
          channel: 'mail',
          level,
        } satisfies InboundViewSummary,
      ],
    }),
    [`GET ${CODES_PATH}`]: jsonResponse({ data: [] }),
    [`GET ${HISTORY_PATH}`]: jsonResponse({
      data: [
        {
          id: RECEIPT_ID,
          receivedAt: '2026-11-14T09:30:00.000Z',
          signingDomain: 'github.com',
          templateKind: 'login_code',
        },
        {
          id: OTHER_RECEIPT_ID,
          receivedAt: '2026-11-14T08:30:00.000Z',
          signingDomain: 'gitlab.com',
          templateKind: 'login_code',
        },
      ],
      page: { nextCursor: null, limit: 25 },
    }),
    ...kindRoutes('subject', subjectContent, subject),
    ...kindRoutes('body', bodyContent, body),
  });
}

type User = ReturnType<typeof userEvent.setup>;

/** Todo lo guardado en un almacenamiento del navegador, como un solo texto. */
function storageDump(storage: Storage): string {
  const entries: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) entries.push(`${key}=${storage.getItem(key) ?? ''}`);
  }
  return entries.join('\n');
}

const OPEN_NAME = /Ver el correo recibido el/;

async function historyTable(): Promise<HTMLElement> {
  return screen.findByRole('table', { name: t['history.caption'] });
}

async function openDialog(user: User): Promise<HTMLElement> {
  const table = await historyTable();
  const buttons = await within(table).findAllByRole('button', { name: OPEN_NAME });
  const firstRowButton = buttons[0];
  if (firstRowButton === undefined) throw new Error('No preview button in the first row');
  await user.click(firstRowButton);
  return screen.findByRole('dialog', { name: /Correo recibido el/ });
}

async function viewSubject(user: User, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: t['mailPreview.subject.action'] }));
}

async function requestBody(user: User, dialog: HTMLElement, reason: string): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }));
  await user.type(field(t['mailPreview.body.reason']), reason);
  await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.submit'] }));
}

describe('mail preview visibility', () => {
  it('is offered next to delete with inbound.delete_mail and MANAGE, without the body action', async () => {
    const user = userEvent.setup();
    setup({ permissions: PREVIEWER_PERMISSIONS });
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    expect((await within(table).findAllByRole('button', { name: OPEN_NAME }))[0]).toBeVisible();
    expect(
      within(table).getAllByRole('button', { name: /Borrar del buzón el correo/ })[0],
    ).toBeVisible();

    const dialog = await openDialog(user);
    expect(
      within(dialog).getByRole('button', { name: t['mailPreview.subject.action'] }),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: t['mailPreview.body.action'] })).toBeNull();
  });

  it('offers the full body only with inbound.reveal_reset', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    expect(
      within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }),
    ).toBeVisible();
  });

  it('is not offered without the permission, even with MANAGE', async () => {
    setup({ permissions: ['inbound.read_codes', 'inbound.reveal_reset'] });
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    await within(table).findByText('github.com');
    expect(within(table).queryByRole('button', { name: OPEN_NAME })).toBeNull();
  });

  it('is not offered with a level below MANAGE, even with the permission', async () => {
    setup({ level: 'EDIT' });
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    await within(table).findByText('github.com');
    expect(within(table).queryByRole('button', { name: OPEN_NAME })).toBeNull();
  });
});

describe('mail preview subject flow', () => {
  it('requests, polls, reads once and shows the subject', async () => {
    const user = userEvent.setup();
    const api = setup();
    const { queryClient } = renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);

    expect(within(dialog).getByText(t['mailPreview.audited'])).toBeVisible();
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject`)).toHaveLength(0);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(SUBJECT)).toBeVisible();
    expect(
      within(dialog).getByRole('heading', { name: t['mailPreview.subject.label'] }),
    ).toBeVisible();
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject`)).toHaveLength(1);
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject/read`)).toHaveLength(1);
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject`)[0]?.body).toEqual({});
    // Entrega única: ya leído, no se vuelve a ofrecer.
    expect(
      within(dialog).queryByRole('button', { name: t['mailPreview.subject.action'] }),
    ).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);

    // El contenido no pasa por la caché de datos ni por el almacenamiento del navegador.
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain(SUBJECT);
    expect(storageDump(localStorage)).not.toContain(SUBJECT);
    expect(storageDump(sessionStorage)).not.toContain(SUBJECT);
    expect(window.location.href).not.toContain(encodeURIComponent(SUBJECT));
  });

  it('shows the pending state with text while the worker has not finished', async () => {
    const user = userEvent.setup();
    setup({ subject: { get: pendingStatus } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(t['mailPreview.status.pending'])).toBeVisible();
    expect(within(dialog).getByText(t['mailPreview.status.waiting'])).toBeVisible();
  });

  it('warns that it takes longer than expected after the polling limit and allows checking again', async () => {
    const user = userEvent.setup();
    const api = setup({ subject: { get: pendingStatus } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(t['mailPreview.status.slow'])).toBeVisible();
    const callsBefore = api.callsTo('GET', `${PREVIEW_PATH}/subject`).length;
    await user.click(within(dialog).getByRole('button', { name: t['mailPreview.status.recheck'] }));
    await waitFor(() => {
      expect(api.callsTo('GET', `${PREVIEW_PATH}/subject`).length).toBeGreaterThan(callsBefore);
    });
    // Consultar de nuevo no vuelve a pedir ni a leer.
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject`)).toHaveLength(1);
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject/read`)).toHaveLength(0);
  });

  it('shows INBOUND.MAIL_NOT_PREVIEWABLE from the API and keeps the actions', async () => {
    const user = userEvent.setup();
    setup({ subject: { post: problem(422, 'INBOUND.MAIL_NOT_PREVIEWABLE') } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(
      await within(dialog).findByText(new RegExp(es.errors['INBOUND.MAIL_NOT_PREVIEWABLE'])),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: t['mailPreview.subject.action'] }),
    ).toBeVisible();
  });
});

describe('mail preview body flow', () => {
  it('asks for the reason in the same step with the audit warning, then shows the body once', async () => {
    const user = userEvent.setup();
    const api = setup();
    const { queryClient } = renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }));
    expect(within(dialog).getByText(t['mailPreview.body.warning'])).toBeVisible();
    expect(api.callsTo('POST', `${PREVIEW_PATH}/body`)).toHaveLength(0);
    await user.type(field(t['mailPreview.body.reason']), REASON);
    await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.submit'] }));

    const region = await within(dialog).findByRole('region', { name: t['mailPreview.body.label'] });
    expect(region).toHaveTextContent('Tu código es 123456.');
    expect(region).toHaveClass('font-mono', 'bg-raised', 'whitespace-pre-wrap');
    expect(api.callsTo('POST', `${PREVIEW_PATH}/body`)[0]?.body).toEqual({ reason: REASON });
    expect(api.callsTo('POST', `${PREVIEW_PATH}/body/read`)).toHaveLength(1);
    expect(api.callsTo('POST', `${PREVIEW_PATH}/body/read`)[0]?.body).toEqual({ reason: REASON });
    expect(within(dialog).getByText(t['mailPreview.shown.notice'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);

    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain('123456');
  });

  it('keeps the subject visible while the body is requested', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);
    await within(dialog).findByText(SUBJECT);
    await requestBody(user, dialog, REASON);

    await within(dialog).findByRole('region', { name: t['mailPreview.body.label'] });
    expect(within(dialog).getByText(SUBJECT)).toBeVisible();
  });

  it.each(['abc', '        '])(
    'does not call the API with an invalid reason (%#)',
    async (reason) => {
      const user = userEvent.setup();
      const api = setup();
      renderApp(VIEW_PAGE);
      const dialog = await openDialog(user);

      await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }));
      await user.type(field(t['mailPreview.body.reason']), reason);
      await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.submit'] }));

      expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
      expect(api.callsTo('POST', `${PREVIEW_PATH}/body`)).toHaveLength(0);
      expect(api.callsTo('POST', `${PREVIEW_PATH}/body/read`)).toHaveLength(0);
    },
  );

  it('shows the server rejection of the reason on the field', async () => {
    const user = userEvent.setup();
    setup({ body: { post: problem(422, 'CREDENTIAL.REASON_INVALID') } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await requestBody(user, dialog, REASON);

    expect(await within(dialog).findByText(es.errors['CREDENTIAL.REASON_INVALID'])).toBeVisible();
    expect(field(t['mailPreview.body.reason'])).toHaveValue(REASON);
  });

  it('cancelling the reason form returns to the start without calling the API', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }));
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));

    expect(
      within(dialog).getByRole('button', { name: t['mailPreview.subject.action'] }),
    ).toBeVisible();
    expect(api.callsTo('POST', `${PREVIEW_PATH}/body`)).toHaveLength(0);
  });
});

describe('mail preview failures', () => {
  it.each(INBOUND_MAIL_PREVIEW_FAILURE_CODES)(
    'shows an actionable message for %s and allows asking again',
    async (resultCode) => {
      const user = userEvent.setup();
      setup({ subject: { get: failedStatus(resultCode) } });
      renderApp(VIEW_PAGE);
      const dialog = await openDialog(user);
      await viewSubject(user, dialog);

      expect(await within(dialog).findByText(t[`mailPreview.result.${resultCode}`])).toBeVisible();
      expect(within(dialog).getByText(t['mailPreview.status.failed'])).toBeVisible();
      expect(within(dialog).queryByText(SUBJECT)).toBeNull();
      expect(
        within(dialog).getByRole('button', { name: t['mailPreview.status.retry'] }),
      ).toBeVisible();
    },
  );

  it('treats a failed body preview the same way', async () => {
    const user = userEvent.setup();
    setup({ body: { get: failedStatus('TOO_LARGE') } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await requestBody(user, dialog, REASON);

    expect(await within(dialog).findByText(t['mailPreview.result.TOO_LARGE'])).toBeVisible();
  });

  it('says it was already read or expired when the read answers NOT_FOUND', async () => {
    const user = userEvent.setup();
    setup({ subject: { read: problem(404, 'NOT_FOUND') } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(t['mailPreview.status.gone'])).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: t['mailPreview.status.recheck'] }),
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: t['mailPreview.status.retry'] }),
    ).toBeVisible();
  });

  it('says it expired when the status has no live preview anymore', async () => {
    const user = userEvent.setup();
    setup({ subject: { get: jsonResponse({ data: null }) } });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(t['mailPreview.status.gone'])).toBeVisible();
  });

  it('offers retrying only the read after a transport error, without asking again', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const api = setup({
      subject: {
        read: () => {
          reads += 1;
          return reads === 1
            ? problem(500, 'INTERNAL')
            : jsonResponse({ data: { kind: 'subject', content: SUBJECT } });
        },
      },
    });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    await user.click(
      await within(dialog).findByRole('button', { name: es.common['actions.retry'] }),
    );
    expect(await within(dialog).findByText(SUBJECT)).toBeVisible();
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject`)).toHaveLength(1);
    expect(api.callsTo('POST', `${PREVIEW_PATH}/subject/read`)).toHaveLength(2);
  });
});

describe('mail preview content lifetime and rendering', () => {
  it('discards the subject when the dialog closes and does not bring it back when reopened', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);
    await within(dialog).findByText(SUBJECT);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SUBJECT);

    const reopened = await openDialog(user);
    expect(within(reopened).queryByText(SUBJECT)).toBeNull();
    expect(
      within(reopened).getByRole('button', { name: t['mailPreview.subject.action'] }),
    ).toBeVisible();
  });

  it('returns focus to the trigger when the dialog closes', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    const trigger = (await within(table).findAllByRole('button', { name: OPEN_NAME }))[0];
    if (trigger === undefined) throw new Error('No preview button in the first row');
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('discards the body with the explicit close button', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await requestBody(user, dialog, REASON);
    await within(dialog).findByRole('region', { name: t['mailPreview.body.label'] });

    const closeButtons = within(dialog).getAllByRole('button', {
      name: es.common['actions.close'],
    });
    const visibleCloseButton = closeButtons[closeButtons.length - 1];
    if (visibleCloseButton === undefined) throw new Error('No close button');
    await user.click(visibleCloseButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain('123456');
  });

  it('never leaves the content in another row nor after unmounting', async () => {
    const user = userEvent.setup();
    setup();
    const view = renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);
    await within(dialog).findByText(SUBJECT);

    const table = await screen.findByRole('table', { name: t['history.caption'], hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    const otherRow = rows.find((row) => row.textContent.includes('gitlab.com'));
    expect(otherRow).toBeDefined();
    expect(otherRow?.textContent).not.toContain(SUBJECT);
    expect(table.textContent).not.toContain(SUBJECT);

    view.unmount();
    expect(document.body.textContent).not.toContain(SUBJECT);
  });

  it('renders markup and links in the subject and body as literal text', async () => {
    const user = userEvent.setup();
    const hostileSubject = '<b>Urgente</b> https://example.com/reset?token=abc';
    const hostileBody =
      '<script>alert(1)</script>\n<a href="https://example.com">pulsa</a>\nhttps://example.com/x';
    setup({ subjectContent: hostileSubject, bodyContent: hostileBody });
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);
    await viewSubject(user, dialog);

    expect(await within(dialog).findByText(hostileSubject)).toBeVisible();
    await requestBody(user, dialog, REASON);
    const region = await within(dialog).findByRole('region', { name: t['mailPreview.body.label'] });

    expect(region.textContent).toBe(hostileBody);
    expect(region.querySelector('script, a, b')).toBeNull();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.querySelector('b')).toBeNull();
    expect(region).toHaveClass('whitespace-pre-wrap');
  });
});

describe('mail preview accessibility and texts', () => {
  it('opens a labelled modal dialog and the reason form has no violations', async () => {
    const user = userEvent.setup();
    setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);

    expect(dialog).toHaveAttribute('aria-describedby');
    expect(within(dialog).getByText(t['mailPreview.dialog.description'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: t['mailPreview.body.action'] }));
    expect(field(t['mailPreview.body.reason'])).toHaveFocus();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('has every new key in both languages with the same variables', () => {
    const spanish: Record<string, string> = t;
    const english: Record<string, string> = tEn;
    const keysOf = (catalog: Record<string, string>) =>
      Object.keys(catalog)
        .filter((key) => key.startsWith('mailPreview.'))
        .sort();
    const placeholders = (text: string | undefined) =>
      [...(text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();

    const spanishKeys = keysOf(spanish);
    expect(spanishKeys.length).toBeGreaterThan(0);
    expect(keysOf(english)).toEqual(spanishKeys);
    for (const key of spanishKeys) {
      expect(placeholders(english[key]), key).toEqual(placeholders(spanish[key]));
    }
    for (const code of INBOUND_MAIL_PREVIEW_FAILURE_CODES) {
      expect(spanish[`mailPreview.result.${code}`], code).toBeTruthy();
      expect(english[`mailPreview.result.${code}`], code).toBeTruthy();
    }
  });
});
