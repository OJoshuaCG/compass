import type { OidcClient } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, StatusBadge, type Column } from '@iam/ui';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime, useClientPagination } from '../../../shared/lib';
import { RankBadge } from '../../directory';

export type OidcClientsTableProps = {
  clients: OidcClient[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Zona horaria de la persona para mostrar la fecha de registro. */
  timeZone: string | undefined;
  /** Acción de la pantalla vacía («Registrar aplicación»); `undefined` si no se ofrece. */
  emptyAction: ReactNode;
  onRotate: (client: OidcClient) => void;
  onDisable: (client: OidcClient) => void;
};

/**
 * Tabla estándar de aplicaciones OIDC. Presentacional: el estado y el tipo van como texto (con
 * ícono el estado), nunca solo color; el identificador y la fecha, en monoespaciada. Una
 * aplicación deshabilitada no ofrece acciones: no se puede reactivar ni rotar.
 */
export function OidcClientsTable({
  clients,
  status,
  errorMessage,
  onRetry,
  timeZone,
  emptyAction,
  onRotate,
  onDisable,
}: OidcClientsTableProps) {
  const { t, i18n } = useTranslation(['oidcClients', 'common']);
  const labels = useDataTableLabels();
  const paging = useClientPagination(clients);

  const columns = useMemo<Column<OidcClient>[]>(
    () => [
      {
        id: 'name',
        header: t('col.name', { ns: 'oidcClients' }),
        cell: (row) => <span className="font-medium break-words text-text">{row.name}</span>,
      },
      {
        id: 'clientId',
        header: t('col.clientId', { ns: 'oidcClients' }),
        cell: (row) => <span className="font-mono text-sm break-all">{row.clientId}</span>,
      },
      {
        id: 'status',
        header: t('col.status', { ns: 'oidcClients' }),
        cell: (row) => (
          <StatusBadge
            status={row.status === 'active' ? 'success' : 'neutral'}
            label={t(`status.${row.status}`, { ns: 'oidcClients' })}
          />
        ),
      },
      {
        id: 'kind',
        header: t('col.kind', { ns: 'oidcClients' }),
        cell: (row) => (
          <Badge tone={row.isExternal ? 'info' : 'neutral'}>
            {t(row.isExternal ? 'kind.external' : 'kind.internal', { ns: 'oidcClients' })}
          </Badge>
        ),
      },
      {
        id: 'maxRank',
        header: t('col.maxRank', { ns: 'oidcClients' }),
        cell: (row) =>
          row.maxRank === null ? (
            <span className="text-text-secondary">{t('maxRank.any', { ns: 'oidcClients' })}</span>
          ) : (
            <RankBadge
              rank={row.maxRank}
              label={t('maxRank.upTo', {
                ns: 'oidcClients',
                rank: t(`rank.${String(row.maxRank)}`, { ns: 'common' }),
              })}
            />
          ),
      },
      {
        id: 'createdAt',
        header: t('col.createdAt', { ns: 'oidcClients' }),
        cell: (row) => (
          <span className="font-mono text-sm">
            {formatDateTime(row.createdAt, i18n.language, timeZone)}
          </span>
        ),
      },
    ],
    [t, i18n.language, timeZone],
  );

  return (
    <DataTable<OidcClient>
      caption={t('caption', { ns: 'oidcClients' })}
      columns={columns}
      rows={paging.pageRows}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      labels={labels}
      emptyState={
        <EmptyState
          title={t('empty.title', { ns: 'oidcClients' })}
          description={t('empty.description', { ns: 'oidcClients' })}
          action={emptyAction}
        />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) =>
        row.status === 'active' ? (
          <span className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('action.rotateLabel', { ns: 'oidcClients', name: row.name })}
              onClick={() => {
                onRotate(row);
              }}
            >
              {t('action.rotate', { ns: 'oidcClients' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('action.disableLabel', { ns: 'oidcClients', name: row.name })}
              onClick={() => {
                onDisable(row);
              }}
            >
              {t('action.disable', { ns: 'oidcClients' })}
            </Button>
          </span>
        ) : null
      }
    />
  );
}
