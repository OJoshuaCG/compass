import type { Permission, SmtpSettings } from '@iam/contracts';
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
const SMTP_PATH = '/integrations/smtp';
const SMTP_ID = '0190d3c4-0000-7000-8000-000000000002';
const ITEM_PATH = `${SMTP_PATH}/${SMTP_ID}`;
const PERMISSIONS: Permission[] = ['alerts.infra.manage'];
const PASSWORD = 'Sup3r-secret-smtp-pass';
const NEW_PASSWORD = 'An0ther-secret-pass';

const t = es.integrations;
const withName = (template: string, name: string) => template.replace('{{name}}', name);

const smtpFixture = (overrides: Partial<SmtpSettings> = {}): SmtpSettings => ({
  id: SMTP_ID,
  name: 'Correo corporativo',
  status: 'active',
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'mailer@example.com',
  fromAddress: 'no-reply@example.com',
  hasPassword: true,
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
    [`GET ${SMTP_PATH}`]: jsonResponse({ data: [] }),
    ...routes,
  });
}

async function sectionLoaded(): Promise<void> {
  await screen.findByRole('heading', { name: t['smtp.title'] });
}

describe('smtp settings: not configured', () => {
  it('explains that the platform server is used and offers to set one up', async () => {
    setup();
    renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText(t['smtp.empty'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['smtp.actions.configure'] })).toBeVisible();
  });

  it('creates the server sending every field, then shows it without the password', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = setup({
      [`GET ${SMTP_PATH}`]: () => jsonResponse({ data: created ? [smtpFixture()] : [] }),
      [`POST ${SMTP_PATH}`]: () => {
        created = true;
        return jsonResponse(smtpFixture(), 201);
      },
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.create.title'] });
    expect(await axeViolations(dialog)).toEqual([]);

    await user.type(field(t['smtp.form.name']), 'Correo corporativo');
    await user.type(field(t['smtp.form.host']), 'smtp.example.com');
    await user.type(field(t['smtp.form.username']), 'mailer@example.com');
    await user.type(field(t['smtp.form.fromAddress']), 'no-reply@example.com');
    await user.type(field(t['smtp.form.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.create.submit'] }));

    expect(await screen.findByText(t['smtp.created'])).toBeVisible();
    expect(api.callsTo('POST', SMTP_PATH)[0]?.body).toEqual({
      name: 'Correo corporativo',
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'mailer@example.com',
      fromAddress: 'no-reply@example.com',
      password: PASSWORD,
    });
    expect(await screen.findByText('Correo corporativo')).toBeVisible();
    expect(screen.getByText(t['smtp.details.passwordSaved'])).toBeVisible();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it('does not send anything when the port or the sender have the wrong format', async () => {
    const user = userEvent.setup();
    const api = setup();
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.create.title'] });
    await user.type(field(t['smtp.form.name']), 'Correo');
    await user.type(field(t['smtp.form.host']), 'smtp.example.com');
    const port = field(t['smtp.form.port']);
    await user.clear(port);
    await user.type(port, '99999');
    await user.type(field(t['smtp.form.username']), 'mailer');
    await user.type(field(t['smtp.form.fromAddress']), 'no-es-un-correo');
    await user.type(field(t['smtp.form.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.create.submit'] }));

    await waitFor(() => {
      expect(field(t['smtp.form.port'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field(t['smtp.form.fromAddress'])).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', SMTP_PATH)).toHaveLength(0);
  });

  it('shows the server rule when an active server already exists', async () => {
    const user = userEvent.setup();
    setup({ [`POST ${SMTP_PATH}`]: problem(409, 'INTEGRATIONS.CHANNEL_ALREADY_ACTIVE') });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.configure'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.create.title'] });
    await user.type(field(t['smtp.form.name']), 'Correo');
    await user.type(field(t['smtp.form.host']), 'smtp.example.com');
    await user.type(field(t['smtp.form.username']), 'mailer');
    await user.type(field(t['smtp.form.fromAddress']), 'no-reply@example.com');
    await user.type(field(t['smtp.form.password']), PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.create.submit'] }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      es.errors['INTEGRATIONS.CHANNEL_ALREADY_ACTIVE'],
    );
  });
});

describe('smtp settings: configured', () => {
  const configured = () => setup({ [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }) });

  it('shows server, user and sender, never the password', async () => {
    configured();
    const { container } = renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText('smtp.example.com:587')).toBeVisible();
    expect(screen.getByText('mailer@example.com')).toBeVisible();
    expect(screen.getByText('no-reply@example.com')).toBeVisible();
    expect(screen.getByText(t['smtp.details.passwordSaved'])).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('flags a server without password and disables the test', async () => {
    setup({ [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture({ hasPassword: false })] }) });
    renderApp(PAGE);
    await sectionLoaded();

    expect(await screen.findByText(t['smtp.details.passwordMissing'])).toBeVisible();
    expect(screen.getByRole('button', { name: t['smtp.actions.test'] })).toBeDisabled();
  });

  it('sends the test email and reports where it was delivered', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }),
      [`POST ${ITEM_PATH}/test`]: jsonResponse({ outcome: 'sent' }),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.test'] }));

    expect(
      await screen.findByText(t['smtp.test.sent'].replace('{{address}}', 'no-reply@example.com')),
    ).toBeVisible();
    expect(api.callsTo('POST', `${ITEM_PATH}/test`)).toHaveLength(1);
  });

  it('explains a failed test by its stable code, without echoing the server text', async () => {
    const user = userEvent.setup();
    setup({
      [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }),
      [`POST ${ITEM_PATH}/test`]: jsonResponse({ outcome: 'AUTH_REJECTED' }),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.test'] }));

    expect(await screen.findByText(t['smtp.test.AUTH_REJECTED'])).toBeVisible();
  });

  it('edits the sender with a PUT that carries no password', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }),
      [`PUT ${ITEM_PATH}`]: jsonResponse(smtpFixture({ fromAddress: 'avisos@example.com' })),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.edit'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.edit.title'] });
    const sender = field(t['smtp.form.fromAddress']);
    await user.clear(sender);
    await user.type(sender, 'avisos@example.com');
    await user.click(within(dialog).getByRole('button', { name: t['smtp.edit.submit'] }));

    expect(await screen.findByText(t['smtp.updated'])).toBeVisible();
    expect(api.callsTo('PUT', ITEM_PATH)[0]?.body).toEqual({
      name: 'Correo corporativo',
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'mailer@example.com',
      fromAddress: 'avisos@example.com',
    });
  });

  it('does not send a changed destination without the password', async () => {
    const user = userEvent.setup();
    const api = setup({ [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }) });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.edit'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.edit.title'] });
    const host = field(t['smtp.form.host']);
    await user.clear(host);
    await user.type(host, 'smtp.otro.example.com');
    await user.click(within(dialog).getByRole('button', { name: t['smtp.edit.submit'] }));

    await waitFor(() => {
      expect(field(t['smtp.form.newPassword'])).toHaveAttribute('aria-invalid', 'true');
    });
    expect(api.callsTo('PUT', ITEM_PATH)).toHaveLength(0);
  });

  it('sends the password together with a changed destination and never shows it', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }),
      [`PUT ${ITEM_PATH}`]: jsonResponse(smtpFixture({ host: 'smtp.otro.example.com' })),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.edit'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.edit.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    const host = field(t['smtp.form.host']);
    await user.clear(host);
    await user.type(host, 'smtp.otro.example.com');
    await user.type(field(t['smtp.form.newPassword']), NEW_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.edit.submit'] }));

    expect(await screen.findByText(t['smtp.updated'])).toBeVisible();
    expect(api.callsTo('PUT', ITEM_PATH)[0]?.body).toMatchObject({
      host: 'smtp.otro.example.com',
      password: NEW_PASSWORD,
    });
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);
  });

  it('replaces the password through its own request', async () => {
    const user = userEvent.setup();
    const api = setup({
      [`GET ${SMTP_PATH}`]: jsonResponse({ data: [smtpFixture()] }),
      [`PUT ${ITEM_PATH}/password`]: jsonResponse(smtpFixture()),
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.changePassword'] }));
    const dialog = await screen.findByRole('dialog', { name: t['smtp.password.title'] });
    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(field(t['smtp.form.password']), NEW_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.password.submit'] }));

    expect(await screen.findByText(t['smtp.passwordSaved'])).toBeVisible();
    expect(api.callsTo('PUT', `${ITEM_PATH}/password`)[0]?.body).toEqual({
      password: NEW_PASSWORD,
    });
    expect(document.body.textContent).not.toContain(NEW_PASSWORD);
  });

  it('archives only after confirming and then offers to set up a new server', async () => {
    const user = userEvent.setup();
    let archived = false;
    const api = setup({
      [`GET ${SMTP_PATH}`]: () =>
        jsonResponse({ data: [smtpFixture({ status: archived ? 'archived' : 'active' })] }),
      [`DELETE ${ITEM_PATH}`]: () => {
        archived = true;
        return jsonResponse(smtpFixture({ status: 'archived' }));
      },
    });
    renderApp(PAGE);
    await sectionLoaded();

    await user.click(await screen.findByRole('button', { name: t['smtp.actions.archive'] }));
    const dialog = await screen.findByRole('dialog', {
      name: withName(t['smtp.archive.title'], 'Correo corporativo'),
    });
    expect(api.callsTo('DELETE', ITEM_PATH)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: t['smtp.archive.confirm'] }));

    expect(await screen.findByText(t['smtp.archived'])).toBeVisible();
    expect(api.callsTo('DELETE', ITEM_PATH)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t['smtp.actions.configure'] })).toBeVisible();
    });
  });
});
