import type { InboundSourceSummary } from '@iam/contracts';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  StatusBadge,
  type Column,
  type Status,
} from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime, type ClientPagination } from '../../../shared/lib';
import { canArchiveSource, canRenameSource } from '../model/inbound-source-model';

const NO_OP = () => undefined;

/** El estado se escribe siempre con texto; el tono solo lo refuerza. */
const STATUS_TONE: Record<InboundSourceSummary['status'], Status> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral',
};

export type InboundSourcesTableProps = {
  sources: InboundSourceSummary[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onRename: (source: InboundSourceSummary) => void;
  onArchive: (source: InboundSourceSummary) => void;
  /** El servidor entrega el listado completo (tope de 200): se pagina en memoria. */
  paging: Pick<ClientPagination<InboundSourceSummary>, 'limit' | 'onLimitChange' | 'pagination'>;
  /** Zona horaria del perfil para la fecha de alta. */
  timeZone?: string | undefined;
};

/**
 * Tabla estándar de las fuentes de correo. Qué acciones ofrecer por fila lo dicen las reglas de
 * comodidad del modelo (el servidor decide siempre); qué hacer al elegirlas lo decide el container.
 */
export function InboundSourcesTable({
  sources,
  status,
  errorMessage,
  onRetry,
  onRename,
  onArchive,
  paging,
  timeZone,
}: InboundSourcesTableProps) {
  const { t, i18n } = useTranslation('inbound');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<InboundSourceSummary>[]>(
    () => [
      { id: 'name', header: t('sources.col.name'), cell: (row) => row.displayName },
      { id: 'address', header: t('sources.col.address'), cell: (row) => row.address },
      {
        id: 'status',
        header: t('sources.col.status'),
        cell: (row) => (
          <StatusBadge status={STATUS_TONE[row.status]} label={t(`sources.status.${row.status}`)} />
        ),
      },
      {
        id: 'level',
        header: t('sources.col.level'),
        cell: (row) => <Badge>{t(`level.${row.level}`)}</Badge>,
      },
      {
        id: 'createdAt',
        header: t('sources.col.createdAt'),
        cell: (row) => formatDateTime(row.createdAt, i18n.language, timeZone),
      },
    ],
    [i18n.language, t, timeZone],
  );

  return (
    <DataTable<InboundSourceSummary>
      caption={t('sources.caption')}
      columns={columns}
      rows={sources}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      labels={labels}
      emptyState={
        <EmptyState title={t('sources.empty.title')} description={t('sources.empty.description')} />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <span className="flex flex-wrap justify-end gap-2">
          {canRenameSource(row) ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('sources.action.renameLabel', { name: row.displayName })}
              onClick={() => {
                onRename(row);
              }}
            >
              {t('sources.action.rename')}
            </Button>
          ) : null}
          {canArchiveSource(row) ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('sources.action.archiveLabel', { name: row.displayName })}
              onClick={() => {
                onArchive(row);
              }}
            >
              {t('sources.action.archive')}
            </Button>
          ) : null}
        </span>
      )}
    />
  );
}
