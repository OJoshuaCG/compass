import type { FetchPage, Page, PageParams } from '../../../shared/api';

export type DemoUser = {
  id: string;
  name: string;
  platform: 'GitHub' | 'Slack' | 'Jira' | 'Google';
  status: 'active' | 'pending' | 'failed' | 'inactive';
};

export const DEMO_SORT_KEYS = ['name', 'platform', 'status'] as const;
export type DemoSortKey = (typeof DEMO_SORT_KEYS)[number];

const PLATFORMS: DemoUser['platform'][] = ['GitHub', 'Slack', 'Jira', 'Google'];
const STATUSES: DemoUser['status'][] = ['active', 'pending', 'failed', 'inactive'];

/**
 * Datos deterministas: 137 filas para que haya varias páginas con cualquier límite. Es una
 * función (no una constante) para que el módulo no tenga efectos al importarse y el bundler
 * pueda descartarlo por completo en producción.
 */
export function createDemoUsers(): DemoUser[] {
  return Array.from({ length: 137 }, (_, index) => ({
    id: `usr_${String(index + 1).padStart(4, '0')}`,
    name: `Persona ${String(index + 1).padStart(3, '0')}`,
    platform: PLATFORMS[index % PLATFORMS.length] ?? 'GitHub',
    status: STATUSES[index % STATUSES.length] ?? 'active',
  }));
}

function isDemoSortKey(value: string | undefined): value is DemoSortKey {
  return (DEMO_SORT_KEYS as readonly (string | undefined)[]).includes(value);
}

/**
 * Simula el listado de la API (mismo contrato: `{ data, page }`, cursor opaco): filtra, ordena
 * y pagina en memoria. Solo existe para el catálogo de desarrollo.
 */
export function createDemoFetcher(
  users: DemoUser[] = createDemoUsers(),
  delayMs = 150,
): FetchPage<DemoUser> {
  return async (params: PageParams, signal: AbortSignal): Promise<Page<DemoUser>> => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    const query = params.q?.trim().toLowerCase() ?? '';
    const filtered = users.filter(
      (user) => query === '' || user.name.toLowerCase().includes(query),
    );
    const key = params.sort;
    const sorted = isDemoSortKey(key)
      ? [...filtered].sort(
          (a, b) => a[key].localeCompare(b[key]) * (params.dir === 'desc' ? -1 : 1),
        )
      : filtered;
    const offset = params.cursor === undefined ? 0 : Number(params.cursor);
    const end = offset + params.limit;
    return {
      data: sorted.slice(offset, end),
      page: {
        nextCursor: end < sorted.length ? String(end) : null,
        limit: params.limit,
        total: sorted.length,
      },
    };
  };
}
