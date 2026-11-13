import type { AccountListItem, SavedAccountView } from '@iam/contracts';
import { SAVED_VIEW_NAME_MAX_LENGTH } from '@iam/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, noContent, problem, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const PLATFORM_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT: AccountListItem = {
  id: '22222222-2222-4222-8222-222222222221',
  platformId: PLATFORM_ID,
  displayName: 'Nómina',
  handle: null,
  ownerGroupId: null,
  tags: [],
  status: 'active',
  myLevel: 'MANAGE',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastChangedAt: null,
  passwordAge: 'none',
};
const VIEW_TEXT: SavedAccountView = {
  id: '33333333-3333-4333-8333-333333333331',
  name: 'Nóminas',
  q: 'nómina',
  filter: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const VIEW_FILTER: SavedAccountView = {
  id: '33333333-3333-4333-8333-333333333332',
  name: 'Pendientes de 2FA',
  q: null,
  filter: 'no-2fa',
  createdAt: '2026-11-02T00:00:00.000Z',
};

const withName = (template: string, name: string) => template.replace('{{name}}', name);
const accountsCalls = (api: ReturnType<typeof stubApi>) => api.callsTo('GET', '/accounts');

function setup(
  views: SavedAccountView[],
  extra: Record<string, Parameters<typeof stubApi>[0][string]> = {},
) {
  return stubApi({
    'GET /me': jsonResponse(meFixture({ permissions: ['account.update'], rank: 1 })),
    'GET /accounts': jsonResponse({ data: [ACCOUNT], page: { nextCursor: null, limit: 25 } }),
    'GET /platforms': jsonResponse({ data: [] }),
    'GET /account-views': () => jsonResponse({ data: views }),
    ...extra,
  });
}

const viewSelect = () => screen.findByRole('combobox', { name: es.accounts['views.label'] });
const saveButton = () => screen.getByRole('button', { name: es.accounts['views.save'] });

describe('saved account views', () => {
  it('applies the text and the quick filter of a view, and clears both with "no view"', async () => {
    const user = userEvent.setup();
    const api = setup([VIEW_TEXT, VIEW_FILTER]);
    renderApp('/accounts');
    const select = await viewSelect();
    await within(select).findByRole('option', { name: VIEW_TEXT.name });
    expect(await axeViolations(document.body)).toEqual([]);

    await user.selectOptions(select, VIEW_TEXT.name);
    await waitFor(() => {
      expect(accountsCalls(api).at(-1)?.search.get('q')).toBe('nómina');
    });
    expect(select).toHaveValue(VIEW_TEXT.id);
    expect(screen.getByRole('searchbox', { name: es.accounts['search.label'] })).toHaveValue(
      'nómina',
    );

    await user.selectOptions(select, VIEW_FILTER.name);
    await waitFor(() => {
      const last = accountsCalls(api).at(-1)?.search;
      expect(last?.get('filter')).toBe('no-2fa');
      expect(last?.has('q')).toBe(false);
    });
    expect(screen.getByRole('button', { name: es.accounts['filter.no2fa'] })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.selectOptions(select, es.accounts['views.none']);
    await waitFor(() => {
      const last = accountsCalls(api).at(-1)?.search;
      expect(last?.has('filter')).toBe(false);
      expect(last?.has('q')).toBe(false);
    });
    expect(select).toHaveValue('');
  });

  it('stops showing a view as active when the criteria change', async () => {
    const user = userEvent.setup();
    setup([VIEW_FILTER]);
    renderApp('/accounts');
    const select = await viewSelect();
    await within(select).findByRole('option', { name: VIEW_FILTER.name });
    await user.selectOptions(select, VIEW_FILTER.name);
    expect(select).toHaveValue(VIEW_FILTER.id);
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(select).toHaveValue('');
    });
  });

  it('enables "Save view" only with a text or a filter applied', async () => {
    const user = userEvent.setup();
    setup([]);
    renderApp('/accounts');
    await viewSelect();
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: es.accounts['filter.all'] }));
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  it('saves the applied text and filter with the chosen name and selects the new view', async () => {
    const user = userEvent.setup();
    const created: SavedAccountView = {
      ...VIEW_TEXT,
      name: 'Revisión de nómina',
      filter: 'review',
    };
    let saved = false;
    const api = setup([], {
      'GET /account-views': () => jsonResponse({ data: saved ? [created] : [] }),
      'POST /account-views': () => {
        saved = true;
        return jsonResponse(created, 201);
      },
    });
    renderApp('/accounts');
    await viewSelect();
    await user.type(screen.getByRole('searchbox', { name: es.accounts['search.label'] }), 'nómina');
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
      expect(accountsCalls(api).at(-1)?.search.get('q')).toBe('nómina');
    });
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: es.accounts['views.saveTitle'] });
    expect(await axeViolations(dialog)).toEqual([]);
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.accounts['views.name']}`)),
      created.name,
    );
    await user.click(within(dialog).getByRole('button', { name: es.accounts['views.saveSubmit'] }));

    expect(
      await screen.findByText(withName(es.accounts['views.saveToast'], created.name)),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/account-views')[0]?.body).toEqual({
      name: created.name,
      q: 'nómina',
      filter: 'review',
    });
    expect(await viewSelect()).toHaveValue(created.id);
  });

  it('requires a name, limits its length and sends nothing when empty', async () => {
    const user = userEvent.setup();
    const api = setup([]);
    renderApp('/accounts');
    await viewSelect();
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: es.accounts['views.saveTitle'] });
    const nameField = within(dialog).getByLabelText(new RegExp(`^${es.accounts['views.name']}`));
    expect(nameField).toHaveAttribute('maxlength', String(SAVED_VIEW_NAME_MAX_LENGTH));
    await user.click(within(dialog).getByRole('button', { name: es.accounts['views.saveSubmit'] }));
    expect(await within(dialog).findByText(es.common['validation.required'])).toBeInTheDocument();
    expect(api.callsTo('POST', '/account-views')).toHaveLength(0);
  });

  it('shows the duplicated-name error next to the field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    setup([], { 'POST /account-views': problem(409, 'SAVED_VIEW.NAME_TAKEN') });
    renderApp('/accounts');
    await viewSelect();
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: es.accounts['views.saveTitle'] });
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.accounts['views.name']}`)),
      'Nóminas',
    );
    await user.click(within(dialog).getByRole('button', { name: es.accounts['views.saveSubmit'] }));
    expect(await within(dialog).findByText(es.errors['SAVED_VIEW.NAME_TAKEN'])).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: es.accounts['views.saveTitle'] })).toBeVisible();
  });

  it('shows the limit error inside the dialog', async () => {
    const user = userEvent.setup();
    setup([], { 'POST /account-views': problem(422, 'SAVED_VIEW.LIMIT_REACHED') });
    renderApp('/accounts');
    await viewSelect();
    await user.click(screen.getByRole('button', { name: es.accounts['filter.review'] }));
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: es.accounts['views.saveTitle'] });
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${es.accounts['views.name']}`)),
      'Otra',
    );
    await user.click(within(dialog).getByRole('button', { name: es.accounts['views.saveSubmit'] }));
    expect(
      await within(dialog).findByText(new RegExp(es.errors['SAVED_VIEW.LIMIT_REACHED'])),
    ).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, then deletes only that view', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const api = setup([VIEW_TEXT, VIEW_FILTER], {
      'GET /account-views': () =>
        jsonResponse({ data: deleted ? [VIEW_FILTER] : [VIEW_TEXT, VIEW_FILTER] }),
      [`DELETE /account-views/${VIEW_TEXT.id}`]: () => {
        deleted = true;
        return noContent();
      },
    });
    renderApp('/accounts');
    const select = await viewSelect();
    await within(select).findByRole('option', { name: VIEW_TEXT.name });
    expect(screen.queryByRole('button', { name: es.accounts['views.delete'] })).toBeNull();
    await user.selectOptions(select, VIEW_TEXT.name);
    await user.click(
      await screen.findByRole('button', {
        name: withName(es.accounts['views.deleteLabel'], VIEW_TEXT.name),
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: withName(es.accounts['views.deleteTitle'], VIEW_TEXT.name),
    });
    expect(await axeViolations(dialog)).toEqual([]);
    expect(api.callsTo('DELETE', `/account-views/${VIEW_TEXT.id}`)).toHaveLength(0);

    await user.click(
      within(dialog).getByRole('button', { name: es.accounts['views.deleteConfirm'] }),
    );

    expect(
      await screen.findByText(withName(es.accounts['views.deleteToast'], VIEW_TEXT.name)),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(select).queryByRole('option', { name: VIEW_TEXT.name })).toBeNull();
    });
  });

  it('cancelling the deletion sends nothing', async () => {
    const user = userEvent.setup();
    const api = setup([VIEW_TEXT]);
    renderApp('/accounts');
    const select = await viewSelect();
    await within(select).findByRole('option', { name: VIEW_TEXT.name });
    await user.selectOptions(select, VIEW_TEXT.name);
    await user.click(
      await screen.findByRole('button', {
        name: withName(es.accounts['views.deleteLabel'], VIEW_TEXT.name),
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: es.common['actions.cancel'] }));
    expect(api.callsTo('DELETE', `/account-views/${VIEW_TEXT.id}`)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the views controls in English too', async () => {
    const { loadAccountsCatalog } = await import('@iam/i18n');
    const en = (await loadAccountsCatalog())['en-US'];
    setup([VIEW_TEXT]);
    renderApp('/accounts', 'en-US');
    expect(await screen.findByRole('combobox', { name: en['views.label'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['views.save'] })).toBeDisabled();
  });
});
