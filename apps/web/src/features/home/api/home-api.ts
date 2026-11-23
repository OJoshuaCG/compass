import { accountListItemSchema, managedUserSchema, MAX_PAGE_LIMIT } from '@iam/contracts';

import { apiClient, createListFetcher, type FetchPage } from '../../../shared/api';
import { summaryCountOf, type SummaryCount } from '../model/summary-count';

/** Fábrica de claves del inicio (docs/frontend.md §7.3). */
export const homeKeys = {
  all: ['home'] as const,
  managedCount: () => [...homeKeys.all, 'managed-count'] as const,
  inventoryCount: () => [...homeKeys.all, 'inventory-count'] as const,
};

// Fetchers propios en vez de importar los de otros features: el inicio solo necesita contar filas
// y así no comparte la forma de su caché con las tablas.
const fetchManagedPage = createListFetcher(apiClient, '/users/managed', managedUserSchema);
const fetchInventoryPage = createListFetcher(
  apiClient,
  '/accounts/inventory',
  accountListItemSchema,
);

/**
 * Una sola página del tamaño máximo: ningún listado devuelve total (ver `summaryCountOf`), así que
 * el conteo es exacto solo si todo cabe en ella.
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

/** `GET /accounts/inventory` (exige `vault.inventory.read`): cuentas activas del inventario. */
export function fetchInventoryCount(signal: AbortSignal): Promise<SummaryCount> {
  return countFirstPage(fetchInventoryPage, signal);
}
