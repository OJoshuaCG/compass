import {
  accountListItemSchema,
  managedUserSchema,
  MAX_PAGE_LIMIT,
  sessionSummarySchema,
} from '@iam/contracts';

import { apiClient, createListFetcher, type FetchPage } from '../../../shared/api';
import { summaryCountOf, type SummaryCount } from '../model/summary-count';

/** Fábrica de claves del inicio (docs/frontend.md §7.3). */
export const homeKeys = {
  all: ['home'] as const,
  managedCount: () => [...homeKeys.all, 'managed-count'] as const,
  inventoryCount: () => [...homeKeys.all, 'inventory-count'] as const,
  sessionsCount: () => [...homeKeys.all, 'sessions-count'] as const,
};

// Se declaran fetchers propios en vez de importar los de otros features: la regla de capas solo
// permite entrar a un feature por su `index.ts`, y el inicio solo necesita contar filas.
const fetchManagedPage = createListFetcher(apiClient, '/users/managed', managedUserSchema);
const fetchInventoryPage = createListFetcher(
  apiClient,
  '/accounts/inventory',
  accountListItemSchema,
);
const fetchSessionsPage = createListFetcher(apiClient, '/me/sessions', sessionSummarySchema);

/**
 * Una sola página del tamaño máximo: ningún listado devuelve total (ver `summaryCountOf`), así que
 * el conteo es exacto solo si todo cabe en ella. Pedir más páginas multiplicaría las peticiones de
 * la pantalla de entrada por una cifra que de todos modos podría no ser exacta.
 */
async function countFirstPage<T>(
  fetchPage: FetchPage<T>,
  signal: AbortSignal,
): Promise<SummaryCount> {
  const page = await fetchPage({ limit: MAX_PAGE_LIMIT }, signal);
  return summaryCountOf(page);
}

/** `GET /users/managed`: personas del subárbol de quien consulta (el servidor decide cuáles). */
export function fetchManagedCount(signal: AbortSignal): Promise<SummaryCount> {
  return countFirstPage(fetchManagedPage, signal);
}

/** `GET /accounts/inventory` (exige `vault.inventory.read`): cuentas del inventario. */
export function fetchInventoryCount(signal: AbortSignal): Promise<SummaryCount> {
  return countFirstPage(fetchInventoryPage, signal);
}

/** `GET /me/sessions`: sesiones vivas de quien consulta. */
export function fetchSessionsCount(signal: AbortSignal): Promise<SummaryCount> {
  return countFirstPage(fetchSessionsPage, signal);
}
