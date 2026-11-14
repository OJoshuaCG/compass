import type {
  InboundMailDeleteStatusResponse,
  InboundViewSummary,
  Permission,
} from '@iam/contracts';
import { loadInboundCatalog } from '@iam/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const catalogs = await loadInboundCatalog();
const t = catalogs['es-MX'];

const VIEW_ID = '66666666-6666-4666-8666-666666666661';
const SOURCE_ID = '77777777-7777-4777-8777-777777777771';
const RECEIPT_ID = '99999999-9999-4999-8999-999999999991';

const VIEWS_PATH = '/inbound/views';
const CODES_PATH = `/inbound/views/${VIEW_ID}/codes`;
const HISTORY_PATH = `/inbound/views/${VIEW_ID}/history`;
const MAIL_DELETE_PATH = `/inbound/receipts/${RECEIPT_ID}/mail-delete`;
const VIEW_PAGE = `/inbound/views/${VIEW_ID}`;

const DELETER_PERMISSIONS: Permission[] = ['inbound.read_codes', 'inbound.delete_mail'];

type Status = NonNullable<InboundMailDeleteStatusResponse['data']>;

const statusFixture = (overrides: Partial<Status>): InboundMailDeleteStatusResponse => ({
  data: {
    status: 'pending',
    resultCode: null,
    requestedAt: '2026-11-14T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  },
});

type SetupOptions = {
  permissions?: Permission[];
  level?: InboundViewSummary['level'];
  post?: Parameters<typeof stubApi>[0][string];
  get?: Parameters<typeof stubApi>[0][string];
};

function setup({
  permissions = DELETER_PERMISSIONS,
  level = 'MANAGE',
  post = jsonResponse({ status: 'pending', alreadyPending: false }, 202),
  get = jsonResponse(statusFixture({})),
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
      ],
      page: { nextCursor: null, limit: 25 },
    }),
    [`POST ${MAIL_DELETE_PATH}`]: post,
    [`GET ${MAIL_DELETE_PATH}`]: get,
  });
}

async function historyTable(): Promise<HTMLElement> {
  return screen.findByRole('table', { name: t['history.caption'] });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const table = await historyTable();
  await user.click(
    await within(table).findByRole('button', { name: /Borrar del buzón el correo/ }),
  );
  return screen.findByRole('dialog');
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const dialog = await openDialog(user);
  await user.click(within(dialog).getByRole('button', { name: t['mailDelete.dialog.confirm'] }));
}

describe('mail delete visibility', () => {
  it('is offered with the inbound.delete_mail permission and MANAGE on the view', async () => {
    setup();
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    expect(
      await within(table).findByRole('button', { name: /Borrar del buzón el correo/ }),
    ).toBeVisible();
  });

  it('is not offered without the permission, even with MANAGE', async () => {
    setup({ permissions: ['inbound.read_codes'] });
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    await within(table).findByText('github.com');
    expect(within(table).queryByRole('button', { name: /Borrar del buzón/ })).toBeNull();
  });

  it('is not offered with a level below MANAGE, even with the permission', async () => {
    setup({ level: 'EDIT' });
    renderApp(VIEW_PAGE);
    const table = await historyTable();
    await within(table).findByText('github.com');
    expect(within(table).queryByRole('button', { name: /Borrar del buzón/ })).toBeNull();
  });
});

describe('mail delete confirmation', () => {
  it('explains the consequences and sends nothing until confirmed', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(VIEW_PAGE);
    const dialog = await openDialog(user);

    expect(within(dialog).getByText(t['mailDelete.dialog.irreversible'])).toBeVisible();
    expect(within(dialog).getByText(t['mailDelete.dialog.realMailbox'])).toBeVisible();
    expect(within(dialog).getByText(t['mailDelete.dialog.notImmediate'])).toBeVisible();
    expect(within(dialog).getByText(t['mailDelete.dialog.audited'])).toBeVisible();
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('POST', MAIL_DELETE_PATH)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.callsTo('POST', MAIL_DELETE_PATH)).toHaveLength(0);
  });

  it('calls the endpoint once on confirm and shows the pending status with text', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(VIEW_PAGE);
    await confirmDelete(user);

    const table = await historyTable();
    expect(await within(table).findByText(t['mailDelete.status.pending'])).toBeVisible();
    expect(api.callsTo('POST', MAIL_DELETE_PATH)).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Mientras sigue pendiente no se ofrece pedirlo otra vez.
    expect(within(table).queryByRole('button', { name: /Borrar del buzón el correo/ })).toBeNull();
    expect(await axeViolations(table)).toEqual([]);
  });
});

describe('mail delete result', () => {
  it('shows Deleted when the request finishes', async () => {
    const user = userEvent.setup();
    setup({ get: jsonResponse(statusFixture({ status: 'done', resultCode: 'DELETED' })) });
    renderApp(VIEW_PAGE);
    await confirmDelete(user);

    const table = await historyTable();
    expect(await within(table).findByText(t['mailDelete.status.done'])).toBeVisible();
    expect(within(table).queryByRole('button', { name: /Borrar del buzón el correo/ })).toBeNull();
  });

  it.each([
    'NOT_FOUND',
    'POSITION_CHANGED',
    'UNSUPPORTED',
    'CONNECTION',
    'CONNECTION_MISSING',
    'UNEXPECTED',
  ] as const)('shows an actionable message for %s and allows asking again', async (resultCode) => {
    const user = userEvent.setup();
    setup({ get: jsonResponse(statusFixture({ status: 'failed', resultCode })) });
    renderApp(VIEW_PAGE);
    await confirmDelete(user);

    const table = await historyTable();
    expect(await within(table).findByText(t[`mailDelete.result.${resultCode}`])).toBeVisible();
    expect(within(table).getByText(t['mailDelete.status.failed'])).toBeVisible();
    expect(within(table).getByRole('button', { name: /Borrar del buzón el correo/ })).toBeVisible();
  });
});

describe('mail delete errors', () => {
  it('shows NOT_FOUND from the API in the dialog and keeps the row', async () => {
    const user = userEvent.setup();
    setup({ post: problem(404, 'NOT_FOUND') });
    renderApp(VIEW_PAGE);
    await confirmDelete(user);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(new RegExp(es.errors['NOT_FOUND']))).toBeVisible();
    // El modal de Radix marca el resto de la página como aria-hidden mientras está abierto: la tabla sigue
    // en el DOM pero fuera del árbol de accesibilidad, por eso se consulta con `hidden: true`.
    const table = await screen.findByRole('table', { name: t['history.caption'], hidden: true });
    expect(within(table).getByText('github.com')).toBeInTheDocument();
    expect(within(table).queryByText(t['mailDelete.status.pending'])).toBeNull();
  });

  it('shows INBOUND.MAIL_NOT_DELETABLE from the API in the dialog', async () => {
    const user = userEvent.setup();
    setup({ post: problem(422, 'INBOUND.MAIL_NOT_DELETABLE') });
    renderApp(VIEW_PAGE);
    await confirmDelete(user);

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(new RegExp(es.errors['INBOUND.MAIL_NOT_DELETABLE'])),
    ).toBeVisible();
  });
});
