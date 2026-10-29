import { resources } from '@iam/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { LOCALE_STORAGE_KEY, detectInitialLocale } from '../shared/i18n';
import { axeViolations } from '../test/axe';

import { meFixture, jsonResponse, problem, stubApi } from '../test/fake-api';
import { renderApp } from '../test/render-app';

const MAIN_CONTENT_ID = 'main-content';

const es = resources['es-MX'].common;
const en = resources['en-US'].common;

// Las rutas privadas piden `/me`: sesión completa de un usuario sin permisos especiales.
beforeEach(() => {
  stubApi({ 'GET /me': jsonResponse(meFixture()) });
});

describe('app shell and routing', () => {
  it('renders Home inside the shell with landmarks, in Spanish by default', async () => {
    renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: es['home.title'] }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: es['nav.label'] })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es-MX');
  });

  it('switches language, updates <html lang> and remembers the choice', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es['home.title'] });
    await user.selectOptions(screen.getByRole('combobox', { name: es['language.label'] }), 'en-US');
    expect(
      await screen.findByRole('heading', { level: 1, name: en['home.title'] }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en-US');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
  });

  it('marks each language option with its own lang so screen readers pronounce it correctly', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es['home.title'] });
    const spanishOption = screen.getByRole('option', { name: es['language.es-MX'] });
    const englishOption = screen.getByRole('option', { name: es['language.en-US'] });
    expect(spanishOption).toHaveAttribute('lang', 'es-MX');
    expect(englishOption).toHaveAttribute('lang', 'en-US');
  });

  it('shows the not-found page for unknown routes', async () => {
    renderApp('/nope');
    expect(await screen.findByText(resources['es-MX'].errors.NOT_FOUND)).toBeInTheDocument();
  });

  it('has no accessibility violations on Home', async () => {
    const { container } = renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    expect(await axeViolations(container)).toEqual([]);
  });
});

/**
 * La región del anunciador de rutas es un `<p role="status">`. Hay otra región `status` siempre
 * montada (la de avisos, un `<div>`), por eso no se puede consultar solo por rol.
 */
function routeAnnouncer(): HTMLElement {
  const announcer = screen
    .getAllByRole('status', { hidden: true })
    .find((region) => region.tagName === 'P');
  if (announcer === undefined) throw new Error('The route announcer region is not mounted');
  return announcer;
}

describe('route announcements', () => {
  it('gives the not-found page a level-1 heading', async () => {
    renderApp('/nope');
    expect(
      await screen.findByRole('heading', { level: 1, name: resources['es-MX'].errors.NOT_FOUND }),
    ).toBeInTheDocument();
  });

  it('titles the not-found screen in both languages', async () => {
    renderApp('/nope', 'en-US');
    await screen.findByRole('heading', { level: 1, name: resources['en-US'].errors.NOT_FOUND });
    await waitFor(() => {
      expect(document.title).toBe(`${resources['en-US'].errors.NOT_FOUND} · ${en['app.name']}`);
    });
  });

  it('offers a skip link to the main content on the not-found screen', async () => {
    renderApp('/nope');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: es['nav.skipToContent'] })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it('offers a skip link in the public layout that targets its main', async () => {
    stubApi({ 'GET /me': problem(401, 'AUTH.UNAUTHENTICATED') });
    renderApp('/login');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: es['nav.skipToContent'] })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID);
  });

  it('sets the document title from the page heading without stealing focus on first load', async () => {
    renderApp('/');
    const heading = await screen.findByRole('heading', { level: 1, name: es['home.title'] });
    await waitFor(() => {
      expect(document.title).toBe(`${es['home.title']} · ${es['app.name']}`);
    });
    expect(heading).not.toHaveFocus();
  });

  it('moves focus to the new heading and updates the title when navigating', async () => {
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es['home.title'] });

    await act(async () => {
      await router.navigate({ to: '/catalog' });
    });

    await screen.findByRole('heading', { level: 1, name: es['catalog.title'] });
    await waitFor(() => {
      expect(screen.getByRole('main')).toHaveFocus();
    });
    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID);
    expect(document.title).toBe(`${es['catalog.title']} · ${es['app.name']}`);
    // La región de estado anuncia el título nuevo.
    expect(routeAnnouncer()).toHaveTextContent(`${es['catalog.title']} · ${es['app.name']}`);
  });

  it('does not move focus nor announce when only the search params of the same route change', async () => {
    const { router } = renderApp('/catalog');
    await screen.findByRole('heading', { level: 1, name: es['catalog.title'] });
    const table = await screen.findByRole('table', { name: es['catalog.table.caption'] });
    const sortButton = within(table).getByRole('button', { name: es['catalog.table.col.name'] });
    sortButton.focus();
    expect(sortButton).toHaveFocus();

    await act(async () => {
      await router.navigate({ to: '/catalog', search: { limit: 10 } });
    });

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ limit: 10 });
    });
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(routeAnnouncer()).toBeEmptyDOMElement();
  });

  it('follows a language change in the title and leaves the focus where it was', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: es['home.title'] });
    const languageSelect = screen.getByRole('combobox', { name: es['language.label'] });

    await user.selectOptions(languageSelect, 'en-US');

    await waitFor(() => {
      expect(document.title).toBe(`${en['home.title']} · ${en['app.name']}`);
    });
    expect(languageSelect).toHaveFocus();
  });
});

describe('first-access locale detection', () => {
  it('detects the browser language only when no preference is stored, and stores it', () => {
    expect(detectInitialLocale('en-GB')).toBe('en-US');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
    // Ya hay preferencia: el idioma del navegador deja de mandar.
    expect(detectInitialLocale('es-MX')).toBe('en-US');
  });

  it('falls back to es-MX for unsupported languages', () => {
    expect(detectInitialLocale('fr-FR')).toBe('es-MX');
  });
});

describe('component catalog route (development only)', () => {
  it('demonstrates the components and a working DataTable', async () => {
    const user = userEvent.setup();
    const { container } = renderApp('/catalog');
    expect(
      await screen.findByRole('heading', { level: 1, name: es['catalog.title'] }),
    ).toBeInTheDocument();

    const table = await screen.findByRole('table', { name: es['catalog.table.caption'] });
    expect(await within(table).findByRole('cell', { name: 'Persona 001' })).toBeInTheDocument();

    // Ordenar por nombre (servidor simulado) deja la columna con aria-sort.
    await user.click(within(table).getByRole('button', { name: es['catalog.table.col.name'] }));
    await waitFor(() => {
      expect(
        within(table).getByRole('columnheader', { name: es['catalog.table.col.name'] }),
      ).toHaveAttribute('aria-sort', 'ascending');
    });

    // Paginación por cursor hacia adelante; "Siguiente" espera a que la vista nueva termine de
    // cargar (con datos de relleno su cursor pertenecería a la vista anterior).
    const next = screen.getByRole('button', { name: es['table.next'] });
    await waitFor(() => {
      expect(next).toBeEnabled();
    });
    await user.click(next);
    expect(await within(table).findByRole('cell', { name: 'Persona 026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es['table.previous'] })).toBeEnabled();

    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the filtered empty state and clears the filter', async () => {
    const user = userEvent.setup();
    renderApp('/catalog?q=zzz');
    expect(await screen.findByText(es['table.emptyFiltered.title'])).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: es['table.clearFilters'] }));
    expect(await screen.findByRole('cell', { name: 'Persona 001' })).toBeInTheDocument();
  });

  it('opens a labelled confirmation dialog before a destructive row action', async () => {
    const user = userEvent.setup();
    renderApp('/catalog');
    const [firstDelete] = await screen.findAllByRole('button', { name: es['actions.delete'] });
    if (firstDelete === undefined) throw new Error('No row delete button');
    await user.click(firstDelete);
    expect(
      await screen.findByRole('dialog', { name: es['catalog.dialog.title'] }),
    ).toBeInTheDocument();
  });

  it('falls back to valid defaults when the URL carries an invalid limit', async () => {
    renderApp('/catalog?limit=7');
    const select = await screen.findByRole('combobox', { name: es['table.rowsPerPage'] });
    expect(select).toHaveValue('25');
  });
});
