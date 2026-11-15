import type { Permission, TelegramIntegration } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, problem, stubApi } from '../../test/fake-api';
import { es, field } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PAGE = '/alerts';
const SETTINGS_PATH = '/integrations/alert-settings';
const TELEGRAM_PATH = '/integrations/telegram';
const CHANNEL_ID = '0190d3c4-0000-7000-8000-000000000001';
const CHANNEL_PATH = `${TELEGRAM_PATH}/${CHANNEL_ID}`;
const PERMISSIONS: Permission[] = ['alerts.infra.manage'];
const VALID_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NEW_TOKEN = '987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const t = es.integrations;
const withName = (template: string, name: string) => template.replace('{{name}}', name);

const channelFixture = (overrides: Partial<TelegramIntegration> = {}): TelegramIntegration => ({
  id: CHANNEL_ID,
  kind: 'telegram_infra',
  name: 'Guardia de infraestructura',
  status: 'active',
  chatId: '-1001234567890',
  hasBotToken: true,
  createdAt: '2030-01-01T10:00:00.000Z',
  updatedAt: '2030-01-01T10:00:00.000Z',
  ...overrides,
});

type Routes = Parameters<typeof stubApi>[0];

function setup(routes: Routes = {}) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: PERMISSIONS, rank: 0 })),
    [`GET ${SETTINGS_PATH}`]: jsonResponse({
      infrastructure: { email: true, telegram: true },
      version: 0,
      updatedAt: null,
    }),
    [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [] }),
    ...routes,
  });
}

async function sectionLoaded(): Promise<void> {
  await screen.findByRole('heading', { name: t['telegram.title'] });
}

describe('telegram channel: not configured', () => {
  it('explains that only email is used and offers to set up the channel', async () => {
    setup();
    renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText(t['telegram.empty'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['telegram.actions.configure'] })).toBeVisible();
  });

  it('creates the channel sending kind, name, chat and token, then shows it without the token', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      [`GET ${TELEGRAM_PATH}`]: () => jsonResponse({ data: created ? [channelFixture()] : [] }),
      [`POST ${TELEGRAM_PATH}`]: () => {
        created = true;
        return jsonResponse(channelFixture(), 201);
      },
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['telegram.create.title'] });
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(field(t['telegram.form.name']), 'Guardia de infraestructura');
    await user.type(field(t['telegram.form.chatId']), '-1001234567890');
    await user.type(field(t['telegram.form.botToken']), VALID_TOKEN);
    await user.click(within(dialog).getByRole('button', { name: t['telegram.create.submit'] }));

    expect(await screen.findByText(t['telegram.created'])).toBeVisible();
    expect(api.callsTo('POST', TELEGRAM_PATH)[0]?.body).toEqual({
      kind: 'telegram_infra',
      name: 'Guardia de infraestructura',
      chatId: '-1001234567890',
      botToken: VALID_TOKEN,
    });
    expect(await screen.findByText('Guardia de infraestructura')).toBeVisible();
    expect(screen.getByText(t['telegram.details.tokenSaved'])).toBeVisible();
    expect(document.body.textContent).not.toContain(VALID_TOKEN);
  });

  it('does not send anything when the token or the chat have the wrong format', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['telegram.create.title'] });
    await user.type(field(t['telegram.form.name']), 'Guardia');
    await user.type(field(t['telegram.form.chatId']), 'mi-grupo');
    await user.type(field(t['telegram.form.botToken']), 'no-es-un-token');
    await user.click(within(dialog).getByRole('button', { name: t['telegram.create.submit'] }));

    await waitFor(() => {
      expect(field(t['telegram.form.chatId'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field(t['telegram.form.botToken'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', TELEGRAM_PATH)).toHaveLength(0);
  });

  it('shows the server rule when an active channel already exists', async () => {
    const user = userEvent.setup();
    setup({
      [`POST ${TELEGRAM_PATH}`]: problem(409, 'INTEGRATIONS.CHANNEL_ALREADY_ACTIVE'),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['telegram.create.title'] });
    await user.type(field(t['telegram.form.name']), 'Guardia');
    await user.type(field(t['telegram.form.chatId']), '123');
    await user.type(field(t['telegram.form.botToken']), VALID_TOKEN);
    await user.click(within(dialog).getByRole('button', { name: t['telegram.create.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['INTEGRATIONS.CHANNEL_ALREADY_ACTIVE'],
    );
  });
});

describe('telegram channel: configured', () => {
  const configured = () =>
    setup({ [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture()] }) });

  it('shows name, chat and whether a token is saved, never the token', async () => {
    configured();
    const { container } = renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText('Guardia de infraestructura')).toBeVisible();
    expect(screen.getByText('-1001234567890')).toBeVisible();
    expect(screen.getByText(t['telegram.details.tokenSaved'])).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('flags a channel without token and disables the test', async () => {
    setup({
      [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture({ hasBotToken: false })] }),
    });
    renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText(t['telegram.details.tokenMissing'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['telegram.actions.test'] })).toBeDisabled();
  });

  it('sends the test message and reports that it was delivered', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture()] }),
      [`POST ${CHANNEL_PATH}/test`]: jsonResponse({ outcome: 'sent' }),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.test'] }));

    expect(await screen.findByText(t['telegram.test.sent'])).toBeVisible();
    expect(api.callsTo('POST', `${CHANNEL_PATH}/test`)).toHaveLength(1);
  });

  it('explains a failed test by its stable code, without echoing Telegram text', async () => {
    const user = userEvent.setup();
    setup({
      [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture()] }),
      [`POST ${CHANNEL_PATH}/test`]: jsonResponse({ outcome: 'CHAT_REJECTED' }),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.test'] }));

    expect(await screen.findByText(t['telegram.test.CHAT_REJECTED'])).toBeVisible();
  });

  it('edits name and chat with a PUT that carries no token', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture()] }),
      [`PUT ${CHANNEL_PATH}`]: jsonResponse(channelFixture({ chatId: '-100999' })),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.edit'] }));
    const dialog = await screen.findByRole('dialog', { name: t['telegram.edit.title'] });
    expect(within(dialog).queryByLabelText(new RegExp(t['telegram.form.botToken']))).toBeNull();
    const chat = field(t['telegram.form.chatId']);
    await user.clear(chat);
    await user.type(chat, '-100999');
    await user.click(within(dialog).getByRole('button', { name: t['telegram.edit.submit'] }));

    expect(await screen.findByText(t['telegram.updated'])).toBeVisible();
    expect(api.callsTo('PUT', CHANNEL_PATH)[0]?.body).toEqual({
      name: 'Guardia de infraestructura',
      chatId: '-100999',
    });
  });

  it('replaces the token through its own request', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${TELEGRAM_PATH}`]: jsonResponse({ data: [channelFixture()] }),
      [`PUT ${CHANNEL_PATH}/bot-token`]: jsonResponse(channelFixture()),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(
      await screen.findByRole('button', { name: t['telegram.actions.changeToken'] }),
    );
    const dialog = await screen.findByRole('dialog', { name: t['telegram.token.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(field(t['telegram.form.botToken']), NEW_TOKEN);
    await user.click(within(dialog).getByRole('button', { name: t['telegram.token.submit'] }));

    expect(await screen.findByText(t['telegram.tokenSaved'])).toBeVisible();
    expect(api.callsTo('PUT', `${CHANNEL_PATH}/bot-token`)[0]?.body).toEqual({
      botToken: NEW_TOKEN,
    });
    expect(document.body.textContent).not.toContain(NEW_TOKEN);
  });

  it('archives only after confirming and then offers to set up a new channel', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      [`GET ${TELEGRAM_PATH}`]: () =>
        jsonResponse({
          data: [channelFixture({ status: archived ? 'archived' : 'active' })],
        }),
      [`DELETE ${CHANNEL_PATH}`]: () => {
        archived = true;
        return jsonResponse(channelFixture({ status: 'archived' }));
      },
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['telegram.actions.archive'] }));
    const dialog = await screen.findByRole('dialog', {
      name: withName(t['telegram.archive.title'], 'Guardia de infraestructura'),
    });
    expect(api.callsTo('DELETE', CHANNEL_PATH)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: t['telegram.archive.confirm'] }));

    expect(await screen.findByText(t['telegram.archived'])).toBeVisible();
    expect(api.callsTo('DELETE', CHANNEL_PATH)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t['telegram.actions.configure'] })).toBeVisible();
    });
  });
});
