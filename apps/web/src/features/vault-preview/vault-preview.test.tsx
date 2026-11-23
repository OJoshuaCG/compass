import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../../test/axe';
import { jsonResponse, meFixture, stubApi } from '../../test/fake-api';
import { es } from '../../test/helpers';
import { renderApp } from '../../test/render-app';

const c = es.common;
const setup = () => stubApi({ 'GET /me': jsonResponse(meFixture()) });

describe('vault preview route (development only)', () => {
  it('shows the fictitious accounts with health and level, flagged as a preview, without accessibility violations', async () => {
    setup();
    const { container } = renderApp('/vault');
    expect(
      await screen.findByRole('heading', { level: 1, name: c['vaultPreview.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByText(c['vaultPreview.notice'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: c['vaultPreview.newAccount'] })).toBeDisabled();

    const table = await screen.findByRole('table', { name: c['vaultPreview.caption'] });
    expect(await within(table).findByText('Marca Corporativo')).toBeInTheDocument();
    expect(within(table).getAllByText(c['vaultPreview.health.rotate'])).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('filters by view with pressed toggle buttons kept in the URL', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/vault');
    const table = await screen.findByRole('table', { name: c['vaultPreview.caption'] });
    await within(table).findByText('Canal Marca');

    const rotate = screen.getByRole('button', { name: c['vaultPreview.views.rotate'] });
    await user.click(rotate);
    await waitFor(() => {
      expect(within(table).queryByText('Canal Marca')).toBeNull();
    });
    expect(within(table).getByText('Soporte')).toBeInTheDocument();
    expect(rotate).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the filtered empty state and clears both search and view', async () => {
    setup();
    const user = userEvent.setup();
    renderApp('/vault?view=rotate&q=instagram');
    expect(await screen.findByText(c['table.emptyFiltered.title'])).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: c['table.clearFilters'] }));
    expect(await screen.findByText('Canal Marca')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: c['vaultPreview.views.all'] })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
