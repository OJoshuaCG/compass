import {
  loadAccountsCatalog,
  loadCredentialsCatalog,
  loadDirectoryCatalog,
  loadRolesCatalog,
  loadSecurityCatalog,
  loadSessionsCatalog,
  loadSharesCatalog,
  resources,
} from '@iam/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

export const es = {
  common: resources['es-MX'].common,
  errors: resources['es-MX'].errors,
  auth: resources['es-MX'].auth,
  // Catálogos de descarga diferida: en las pruebas se cargan una vez, igual que en la app.
  directory: (await loadDirectoryCatalog())['es-MX'],
  sessions: (await loadSessionsCatalog())['es-MX'],
  roles: (await loadRolesCatalog())['es-MX'],
  security: (await loadSecurityCatalog())['es-MX'],
  accounts: (await loadAccountsCatalog())['es-MX'],
  credentials: (await loadCredentialsCatalog())['es-MX'],
  shares: (await loadSharesCatalog())['es-MX'],
};

/**
 * Campo por su etiqueta. FormField añade un "*" decorativo a los obligatorios dentro del
 * `<label>`, así que se busca por prefijo en vez de por texto exacto.
 */
export function field(label: string): HTMLElement {
  // Se escapan los metacaracteres: una etiqueta como "Caduca el (opcional)" no es un grupo de regex.
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return screen.getByLabelText(new RegExp(`^${escapedLabel}`));
}

/**
 * Textos que las regiones `status` de un contenedor anuncian en este momento. El botón de copiar
 * mantiene siempre montada una región vacía (solo habla al copiar), así que "no hay anuncio
 * duplicado" se comprueba con esta lista vacía y no con la ausencia de la región.
 */
export function announcedStatusTexts(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('status', { hidden: true })
    .map((region) => region.textContent)
    .filter((text) => text !== '');
}

/**
 * Verifica que ningún secreto quedó en la caché de Query (consultas y mutaciones) ni en el
 * almacenamiento del navegador (docs/frontend.md §9).
 */
export function expectNoSecretsStored(queryClient: QueryClient, secrets: readonly string[]) {
  const queries = JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => ({ key: query.queryKey, state: query.state })),
  );
  const mutations = JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => ({ key: mutation.options.mutationKey, state: mutation.state })),
  );
  const storage = JSON.stringify([
    Object.entries(window.localStorage),
    Object.entries(window.sessionStorage),
  ]);
  for (const secret of secrets) {
    expect(queries, `query cache leaks ${secret}`).not.toContain(secret);
    expect(mutations, `mutation cache leaks ${secret}`).not.toContain(secret);
    expect(storage, `web storage leaks ${secret}`).not.toContain(secret);
  }
  expect(window.sessionStorage.length).toBe(0);
}

/**
 * Abre el menú "⋯" de una fila por el nombre de su botón. El menú se descarga en diferido y mientras
 * tanto el botón está deshabilitado, así que se espera a que se habilite antes de pulsarlo.
 */
export async function openRowMenu(user: UserEvent, menuLabel: string): Promise<HTMLElement> {
  const trigger = await waitFor(() => {
    const button = screen.getByRole('button', { name: menuLabel });
    expect(button).toBeEnabled();
    return button;
  });
  await user.click(trigger);
  return trigger;
}

/** Abre el menú de una fila y elige una de sus opciones por su nombre visible. */
export async function chooseRowMenuAction(
  user: UserEvent,
  menuLabel: string,
  itemName: string,
): Promise<void> {
  await openRowMenu(user, menuLabel);
  await user.click(await screen.findByRole('menuitem', { name: itemName }));
}

/**
 * Textos de las opciones del menú, en orden. Lo cierra al terminar: abierto, Radix oculta el resto
 * de la página a las consultas por rol y las comprobaciones posteriores pasarían en falso.
 */
export async function rowMenuItemTexts(user: UserEvent, menuLabel: string): Promise<string[]> {
  await openRowMenu(user, menuLabel);
  const items = await screen.findAllByRole('menuitem');
  const texts = items.map((item) => item.textContent);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('menu')).toBeNull();
  });
  return texts;
}
