import {
  loadDirectoryCatalog,
  loadRolesCatalog,
  loadSecurityCatalog,
  loadSessionsCatalog,
  resources,
} from '@iam/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
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
};

/**
 * Campo por su etiqueta. FormField añade un "*" decorativo a los obligatorios dentro del
 * `<label>`, así que se busca por prefijo en vez de por texto exacto.
 */
export function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label}`));
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
