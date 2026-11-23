import type { FetchPage, Page, PageParams } from '../../../shared/api';

/**
 * Vista previa de la bóveda (solo desarrollo): datos ficticios con la forma que tendrá el listado
 * de cuentas de la fase 1b (B01). No hay API ni secretos: nada de esto sale del navegador.
 */

export type AccessLevel = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE';
export type AccountHealth = 'ok' | 'totpUnverified' | 'noTotp' | 'rotate';
export type AccountAccess = 'passwordAndTotp' | 'passwordOnly';

export type DemoAccount = {
  id: string;
  name: string;
  platform: string;
  handle: string;
  /** Iniciales del mosaico de la plataforma. */
  monogram: string;
  access: AccountAccess;
  level: AccessLevel;
  health: AccountHealth;
  /** Días desde la última rotación de la contraseña. */
  rotatedDaysAgo: number;
  tags: string[];
};

export const VAULT_VIEWS = ['all', 'mine', 'noTotp', 'rotate'] as const;
export type VaultView = (typeof VAULT_VIEWS)[number];

export const VAULT_SORT_KEYS = ['name', 'platform', 'rotatedDaysAgo'] as const;
export type VaultSortKey = (typeof VAULT_SORT_KEYS)[number];

/** Mismas cuentas que el prototipo de diseño. Función (no constante) para que el bundler la descarte. */
export function createDemoAccounts(): DemoAccount[] {
  return [
    {
      id: 'acc_ig',
      name: 'Marca MX',
      platform: 'Instagram',
      handle: '@marca_mx',
      monogram: 'IG',
      access: 'passwordAndTotp',
      level: 'MANAGE',
      health: 'ok',
      rotatedDaysAgo: 12,
      tags: ['redes', 'marca-mx'],
    },
    {
      id: 'acc_tt',
      name: 'Marca MX',
      platform: 'TikTok',
      handle: '@marca.mx',
      monogram: 'TT',
      access: 'passwordAndTotp',
      level: 'EDIT',
      health: 'totpUnverified',
      rotatedDaysAgo: 3,
      tags: ['redes', 'marca-mx'],
    },
    {
      id: 'acc_fb',
      name: 'Página Marca MX',
      platform: 'Facebook',
      handle: 'fb.com/marcamx',
      monogram: 'FB',
      access: 'passwordAndTotp',
      level: 'MANAGE',
      health: 'ok',
      rotatedDaysAgo: 40,
      tags: ['redes', 'marca-mx'],
    },
    {
      id: 'acc_x',
      name: 'Soporte',
      platform: 'X',
      handle: '@marca_soporte',
      monogram: 'X',
      access: 'passwordOnly',
      level: 'MANAGE',
      health: 'rotate',
      rotatedDaysAgo: 96,
      tags: ['soporte'],
    },
    {
      id: 'acc_yt',
      name: 'Canal Marca',
      platform: 'YouTube',
      handle: '@canalmarca',
      monogram: 'YT',
      access: 'passwordAndTotp',
      level: 'VIEW',
      health: 'ok',
      rotatedDaysAgo: 21,
      tags: ['video'],
    },
    {
      id: 'acc_li',
      name: 'Marca Corporativo',
      platform: 'LinkedIn',
      handle: 'linkedin.com/company/marca',
      monogram: 'in',
      access: 'passwordOnly',
      level: 'EDIT',
      health: 'noTotp',
      rotatedDaysAgo: 58,
      tags: ['corporativo'],
    },
    {
      id: 'acc_gm',
      name: 'Operaciones',
      platform: 'Gmail',
      handle: 'ops.marca@gmail.com',
      monogram: 'G',
      access: 'passwordAndTotp',
      level: 'MANAGE',
      health: 'ok',
      rotatedDaysAgo: 9,
      tags: ['correo'],
    },
  ];
}

const VIEW_FILTER: Record<VaultView, (account: DemoAccount) => boolean> = {
  all: () => true,
  // "Mis cuentas": las que gestiono (nivel MANAGE), como en el prototipo.
  mine: (account) => account.level === 'MANAGE',
  noTotp: (account) => account.health === 'noTotp' || account.health === 'totpUnverified',
  rotate: (account) => account.health === 'rotate',
};

/** Filtro de vista y búsqueda por nombre, plataforma, usuario o etiqueta (sin distinguir mayúsculas). */
export function filterAccounts(
  accounts: DemoAccount[],
  view: VaultView,
  query: string | undefined,
): DemoAccount[] {
  const q = query?.trim().toLowerCase() ?? '';
  return accounts.filter(
    (account) =>
      VIEW_FILTER[view](account) &&
      (q === '' ||
        [account.name, account.platform, account.handle, ...account.tags].some((field) =>
          field.toLowerCase().includes(q),
        )),
  );
}

function isSortKey(value: string | undefined): value is VaultSortKey {
  return (VAULT_SORT_KEYS as readonly (string | undefined)[]).includes(value);
}

function compare(a: DemoAccount, b: DemoAccount, key: VaultSortKey): number {
  return key === 'rotatedDaysAgo'
    ? a.rotatedDaysAgo - b.rotatedDaysAgo
    : a[key].localeCompare(b[key]);
}

/**
 * Simula el futuro `GET /vault/accounts` con el contrato de listados (`{ data, page }`, cursor
 * opaco): filtra, ordena y pagina en memoria, con una latencia pequeña para ver la carga.
 */
export function createDemoVaultFetcher(
  view: VaultView,
  accounts: DemoAccount[] = createDemoAccounts(),
  delayMs = 150,
): FetchPage<DemoAccount> {
  return async (params: PageParams, signal: AbortSignal): Promise<Page<DemoAccount>> => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    const filtered = filterAccounts(accounts, view, params.q);
    const key = params.sort;
    const sorted = isSortKey(key)
      ? [...filtered].sort((a, b) => compare(a, b, key) * (params.dir === 'desc' ? -1 : 1))
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
