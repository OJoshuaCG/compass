import {
  Alert,
  AlertTriangle,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Plus,
  RefreshCw,
  SearchInput,
  ShieldCheck,
  cn,
  type Column,
  type LucideIcon,
} from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTableQuery, type TableSearch } from '../../../shared/api';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import {
  createDemoVaultFetcher,
  VAULT_VIEWS,
  type AccountHealth,
  type DemoAccount,
  type VaultView,
} from '../model/demo-accounts';

export type VaultPreviewSearch = TableSearch & { view: VaultView };

export type VaultPreviewPageProps = {
  search: VaultPreviewSearch;
  onSearchChange: (patch: Partial<VaultPreviewSearch>) => void;
};

/** Salud de la cuenta: ícono y texto siempre juntos (el color nunca es el único canal). */
const HEALTH: Record<AccountHealth, { icon: LucideIcon; className: string }> = {
  ok: { icon: ShieldCheck, className: 'text-success' },
  totpUnverified: { icon: AlertTriangle, className: 'text-warning' },
  noTotp: { icon: AlertTriangle, className: 'text-warning' },
  rotate: { icon: RefreshCw, className: 'text-danger' },
};

/**
 * Vista previa de la pantalla de cuentas de la bóveda (diseño de Compass), solo en desarrollo.
 * Usa datos ficticios con el contrato de listados; la pantalla real llegará con B01 (fase 1b).
 */
export function VaultPreviewPage({ search, onSearchChange }: VaultPreviewPageProps) {
  const { t } = useTranslation('common');
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();
  const { view, ...tableSearch } = search;
  // Un fetcher por vista: la vista forma parte de la clave de caché, igual que haría la API.
  const fetchPage = useMemo(() => createDemoVaultFetcher(view), [view]);

  const table = useTableQuery<DemoAccount>({
    queryKey: ['vault-preview', 'accounts', view],
    fetchPage,
    search: tableSearch,
    onSearchChange,
  });

  const columns = useMemo<Column<DemoAccount>[]>(
    () => [
      {
        id: 'name',
        header: t('vaultPreview.col.account'),
        sortKey: 'name',
        cell: (row) => (
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-raised text-sm font-bold text-accent"
            >
              {row.monogram}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold text-text">{row.name}</span>
              <span className="text-text-muted">
                {row.platform} · {row.handle}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: 'access',
        header: t('vaultPreview.col.access'),
        cell: (row) => t(`vaultPreview.access.${row.access}`),
      },
      {
        id: 'level',
        header: t('vaultPreview.col.level'),
        cell: (row) => (
          <code className="rounded-sm bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-accent">
            {row.level}
          </code>
        ),
      },
      {
        id: 'health',
        header: t('vaultPreview.col.health'),
        cell: (row) => {
          const { icon: Icon, className } = HEALTH[row.health];
          return (
            <span className={cn('flex items-center gap-1.5 font-semibold', className)}>
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {t(`vaultPreview.health.${row.health}`)}
            </span>
          );
        },
      },
      {
        id: 'rotatedDaysAgo',
        header: t('vaultPreview.col.rotated'),
        sortKey: 'rotatedDaysAgo',
        cell: (row) => (
          <span className="text-text-muted">
            {t('vaultPreview.rotatedAgo', { count: row.rotatedDaysAgo })}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('vaultPreview.title')}
        description={t('vaultPreview.description')}
        actions={
          <Button disabled title={t('vaultPreview.notAvailable')}>
            <Plus aria-hidden="true" className="size-4" />
            {t('vaultPreview.newAccount')}
          </Button>
        }
      />

      <Alert tone="info">{t('vaultPreview.notice')}</Alert>

      <DataTable<DemoAccount>
        caption={t('vaultPreview.caption')}
        columns={columns}
        rows={table.rows}
        getRowId={(row) => row.id}
        status={table.status}
        sort={table.sort}
        onSortChange={table.onSortChange}
        limit={table.limit}
        onLimitChange={table.onLimitChange}
        pagination={table.pagination}
        refreshing={table.refreshing}
        hasActiveFilters={table.hasActiveFilters || view !== 'all'}
        onClearFilters={() => {
          onSearchChange({ q: undefined, view: 'all' });
        }}
        labels={labels}
        emptyState={
          <EmptyState
            title={t('vaultPreview.empty.title')}
            description={t('vaultPreview.empty.description')}
          />
        }
        errorState={{ message: errorMessage(table.error), onRetry: table.retry }}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput
              className="min-w-0 flex-1 basis-64"
              label={t('vaultPreview.search.label')}
              clearLabel={t('search.clear')}
              placeholder={t('vaultPreview.search.placeholder')}
              value={table.q}
              onValueChange={table.onQueryChange}
            />
            <div
              role="group"
              aria-label={t('vaultPreview.views.label')}
              className="flex flex-wrap gap-2"
            >
              {VAULT_VIEWS.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={option === view ? 'primary' : 'secondary'}
                  aria-pressed={option === view}
                  className="rounded-full"
                  onClick={() => {
                    onSearchChange({ view: option });
                  }}
                >
                  {t(`vaultPreview.views.${option}`)}
                </Button>
              ))}
            </div>
          </div>
        }
      />
    </>
  );
}
