import type { Permission } from '@iam/contracts';
import { resources } from '@iam/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const c = es.common;
const setup = (permissions: Permission[] = ['audit.read_all']) =>
  stubApi({ 'GET /me': jsonResponse(meFixture({ permissions })) });

const settingsTabs = () =>
  screen.getByRole('navigation', {
    name: c['nav.sectionsOf'].replace('{{section}}', c['nav.settings']),
  });

describe('audit preview route (development only)', () => {
  it('shows the chain status and the fictitious events, flagged as a preview, without violations', async () => {
    setup();
    const { container } = renderApp('/audit');
    expect(
      await screen.findByRole('heading', { level: 1, name: c['auditPreview.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByText(c['auditPreview.notice'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: c['auditPreview.export'] })).toBeDisabled();
    expect(
      screen.getByRole('heading', { level: 2, name: c['auditPreview.chain.title'] }),
    ).toBeInTheDocument();

    const table = await screen.findByRole('table', { name: c['auditPreview.caption'] });
    expect(await within(table).findByText('Carlos Vega')).toBeInTheDocument();
    expect(within(table).getAllByText(c['auditPreview.result.denied'])).toHaveLength(2);
    // Lo de hace 10 días queda fuera del periodo por defecto (7 días).
    expect(within(table).queryByText(c['auditPreview.action.otherSessionsClosed'])).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('is a tab of Settings only for people who can read the audit', async () => {
    setup(['audit.read_scope']);
    renderApp('/security');
    await screen.findByRole('link', { name: c['nav.settings'] });
    expect(within(settingsTabs()).getByRole('link', { name: c['nav.audit'] })).toBeVisible();
  });

  it('hides the tab and answers as not found without audit permissions', async () => {
    setup([]);
    renderApp('/security');
    await screen.findByRole('link', { name: c['nav.settings'] });
    expect(within(settingsTabs()).queryByRole('link', { name: c['nav.audit'] })).toBeNull();
  });

  it('answers as not found when /audit is opened without audit permissions', async () => {
    setup([]);
    renderApp('/audit');
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: c['auditPreview.caption'] })).toBeNull();
  });

  it('filters by type with pressed buttons and widens the period', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/audit');
    const table = await screen.findByRole('table', { name: c['auditPreview.caption'] });
    await within(table).findByText('Diego Torres');

    const denied = screen.getByRole('button', { name: `${c['auditPreview.types.denied']} 2` });
    await user.click(denied);
    await waitFor(() => {
      expect(within(table).queryByText('Diego Torres')).toBeNull();
    });
    expect(denied).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getByText('Carlos Vega')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `${c['auditPreview.types.all']} 11` }));
    await user.click(screen.getByRole('button', { name: c['auditPreview.range.30d'] }));
    expect(
      await within(table).findByText(c['auditPreview.action.otherSessionsClosed']),
    ).toBeInTheDocument();
  });

  it('opens the detail of an event with its reason and chaining', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/audit?type=people');
    const table = await screen.findByRole('table', { name: c['auditPreview.caption'] });
    const action = c['auditPreview.action.deactivated'].replace('{{name}}', 'Andrea Núñez');
    await within(table).findByText(action);
    const open = within(table)
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-label')?.includes(action));
    if (open === undefined) throw new Error('missing detail button');
    await user.click(open);

    const dialog = await screen.findByRole('dialog', { name: action });
    expect(within(dialog).getByText('Fin de contrato')).toBeInTheDocument();
    expect(within(dialog).getByText('5f90a3d7c2e18b46f9d0c5a2e7b31f04c6b3')).toBeInTheDocument();
    expect(within(dialog).getByText('b2e1c07f4a9d36e85b1c0a7f2d94e6b304aa')).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('renders in English too', async () => {
    const en = resources['en-US'].common;
    setup();
    renderApp('/audit', 'en-US');
    expect(
      await screen.findByRole('table', { name: en['auditPreview.caption'] }),
    ).toBeInTheDocument();
    expect(await screen.findByText(en['auditPreview.action.passkeyLogin'])).toBeVisible();
  });
});
