import type { Account, Platform } from '@iam/contracts';
import {
  Badge,
  Button,
  buttonVariants,
  DataTable,
  EmptyState,
  StatusBadge,
  type Column,
} from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';

export type AccountsTableProps = {
  /**
   * `mine`: cuentas con acceso (muestra el nivel propio y las acciones). `inventory`: solo
   * metadatos; el nivel siempre llega en `null`, así que ni se pinta ni se ofrecen acciones.
   */
  variant: 'mine' | 'inventory';
  accounts: Account[];
  platforms: readonly Platform[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Decisiones de comodidad que toma el container (permiso + nivel); el servidor decide siempre. */
  canEdit: (account: Account) => boolean;
  canArchive: (account: Account) => boolean;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
  paging: TablePaging;
};

/**
 * Tabla estándar de cuentas. Presentacional: el nivel propio se escribe con texto (nunca solo
 * color) y las acciones aparecen solo cuando el container dice que la fila las admite.
 */
export function AccountsTable({
  variant,
  accounts,
  platforms,
  status,
  errorMessage,
  onRetry,
  canEdit,
  canArchive,
  onEdit,
  onArchive,
  refreshing,
  paging,
}: AccountsTableProps) {
  const { t } = useTranslation('accounts');
  const labels = useDataTableLabels();

  const platformNames = useMemo(
    () => new Map(platforms.map((platform) => [platform.id, platform.name])),
    [platforms],
  );

  const columns = useMemo<Column<Account>[]>(() => {
    const nameColumn: Column<Account> = {
      id: 'name',
      header: t('col.name'),
      cell: (row) => row.displayName,
    };
    const platformColumn: Column<Account> = {
      id: 'platform',
      header: t('col.platform'),
      cell: (row) => platformNames.get(row.platformId) ?? t('platform.unknown'),
    };
    const levelColumn: Column<Account> = {
      id: 'level',
      header: t('col.level'),
      cell: (row) =>
        row.myLevel === null ? t('level.none') : <Badge>{t(`level.${row.myLevel}`)}</Badge>,
    };
    const statusColumn: Column<Account> = {
      id: 'status',
      header: t('col.status'),
      cell: (row) =>
        row.status === 'active' ? (
          <StatusBadge status="success" label={t('status.active')} />
        ) : (
          <StatusBadge status="neutral" label={t('status.archived')} />
        ),
    };
    return variant === 'mine'
      ? [nameColumn, platformColumn, levelColumn, statusColumn]
      : [nameColumn, platformColumn, statusColumn];
  }, [platformNames, t, variant]);

  const emptyTitle = variant === 'mine' ? t('empty.title') : t('inventory.empty.title');
  const emptyDescription =
    variant === 'mine' ? t('empty.description') : t('inventory.empty.description');

  return (
    <DataTable<Account>
      caption={variant === 'mine' ? t('caption') : t('inventory.caption')}
      columns={columns}
      rows={accounts}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      refreshing={refreshing}
      labels={labels}
      emptyState={<EmptyState title={emptyTitle} description={emptyDescription} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={
        variant === 'mine'
          ? (row) => (
              <span className="flex flex-wrap justify-end gap-2">
                {/* Navegación, no acción: es un enlace con aspecto de botón. Todas las filas de
                    "Mis cuentas" tienen al menos USE; el servidor decide qué se ve dentro. */}
                <Link
                  to="/accounts/$accountId/credentials"
                  params={{ accountId: row.id }}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  aria-label={t('action.credentialsLabel', { name: row.displayName })}
                >
                  {t('action.credentials')}
                </Link>
                {canEdit(row) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.editLabel', { name: row.displayName })}
                    onClick={() => {
                      onEdit(row);
                    }}
                  >
                    {t('action.edit')}
                  </Button>
                ) : null}
                {canArchive(row) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.archiveLabel', { name: row.displayName })}
                    onClick={() => {
                      onArchive(row);
                    }}
                  >
                    {t('action.archive')}
                  </Button>
                ) : null}
              </span>
            )
          : undefined
      }
    />
  );
}
