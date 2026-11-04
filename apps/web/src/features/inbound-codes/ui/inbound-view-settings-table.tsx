import type { InboundConfigurableView } from '@iam/contracts';
import { Badge, Button, buttonVariants, DataTable, EmptyState, type Column } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime, type ClientPagination } from '../../../shared/lib';
import { canArchiveView, canEditView, canManageViewShares } from '../model/inbound-view-model';

const NO_OP = () => undefined;

export type InboundViewSettingsTableProps = {
  views: InboundConfigurableView[];
  /** Nombre de cada fuente por id; una fuente que no aparece se escribe como "desconocida". */
  sourceNames: ReadonlyMap<string, string>;
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onEdit: (view: InboundConfigurableView) => void;
  onArchive: (view: InboundConfigurableView) => void;
  /** Si la persona tiene el permiso `share.manage`; junto con MANAGE ofrece los accesos de la vista. */
  hasSharePermission: boolean;
  /** El servidor entrega el listado completo (tope de 200): se pagina en memoria. */
  paging: Pick<ClientPagination<InboundConfigurableView>, 'limit' | 'onLimitChange' | 'pagination'>;
  /** Zona horaria del perfil para la fecha de alta. */
  timeZone?: string | undefined;
};

/**
 * Tabla estándar de las vistas configurables. Qué acciones ofrecer por fila lo dicen las reglas de
 * comodidad del modelo (el servidor decide siempre); qué hacer al elegirlas lo decide el container.
 */
export function InboundViewSettingsTable({
  views,
  sourceNames,
  status,
  errorMessage,
  onRetry,
  onEdit,
  onArchive,
  hasSharePermission,
  paging,
  timeZone,
}: InboundViewSettingsTableProps) {
  const { t, i18n } = useTranslation('inbound');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<InboundConfigurableView>[]>(
    () => [
      {
        id: 'name',
        header: t('viewSettings.col.name'),
        cell: (row) => <span className="font-medium text-text">{row.name}</span>,
      },
      {
        id: 'source',
        header: t('viewSettings.col.source'),
        cell: (row) => sourceNames.get(row.sourceId) ?? t('viewSettings.sourceUnknown'),
      },
      {
        id: 'templates',
        header: t('viewSettings.col.templates'),
        cell: (row) => String(row.templateIds.length),
      },
      {
        id: 'level',
        header: t('viewSettings.col.level'),
        cell: (row) => <Badge dot>{t(`level.${row.level}`)}</Badge>,
      },
      {
        id: 'createdAt',
        header: t('viewSettings.col.createdAt'),
        cell: (row) => (
          <span className="font-mono text-text-secondary">
            {formatDateTime(row.createdAt, i18n.language, timeZone)}
          </span>
        ),
      },
    ],
    [i18n.language, sourceNames, t, timeZone],
  );

  return (
    <DataTable<InboundConfigurableView>
      caption={t('viewSettings.caption')}
      columns={columns}
      rows={views}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      labels={labels}
      emptyState={
        <EmptyState
          title={t('viewSettings.empty.title')}
          description={t('viewSettings.empty.description')}
        />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <span className="flex flex-wrap justify-end gap-2">
          {canEditView(row) ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('viewSettings.action.editLabel', { name: row.name })}
              onClick={() => {
                onEdit(row);
              }}
            >
              {t('viewSettings.action.edit')}
            </Button>
          ) : null}
          {canManageViewShares(hasSharePermission, row) ? (
            <Link
              to="/inbound/views/$viewId/shares"
              params={{ viewId: row.id }}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              aria-label={t('viewSettings.action.sharesLabel', { name: row.name })}
            >
              {t('viewSettings.action.shares')}
            </Link>
          ) : null}
          {canArchiveView(row) ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('viewSettings.action.archiveLabel', { name: row.name })}
              onClick={() => {
                onArchive(row);
              }}
            >
              {t('viewSettings.action.archive')}
            </Button>
          ) : null}
        </span>
      )}
    />
  );
}
