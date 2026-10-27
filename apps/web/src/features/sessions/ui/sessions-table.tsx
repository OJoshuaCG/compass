import type { SessionSummary } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';
import { describeDevice } from '../model/describe-device';

export type SessionsTableProps = {
  sessions: SessionSummary[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onClose: (session: SessionSummary) => void;
  /** Zona horaria del perfil, para mostrar las fechas. */
  timeZone: string | undefined;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
};

/**
 * Tabla estándar de las sesiones propias. Presentacional: el container carga los datos y decide
 * qué pasa al cerrar. La sesión actual no ofrece "Cerrar" (para eso está "Cerrar sesión").
 */
export function SessionsTable({
  sessions,
  status,
  errorMessage,
  onRetry,
  onClose,
  timeZone,
  refreshing,
}: SessionsTableProps) {
  const { t, i18n } = useTranslation('sessions');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<SessionSummary>[]>(
    () => [
      {
        id: 'device',
        header: t('col.device'),
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {describeDevice(row.userAgent) ?? t('device.unknown')}
            {row.current ? <Badge tone="accent">{t('badge.current')}</Badge> : null}
          </span>
        ),
      },
      {
        id: 'ip',
        header: t('col.ip'),
        cell: (row) => (
          <span className="font-mono text-text-secondary">{row.ip ?? t('ip.unknown')}</span>
        ),
      },
      {
        id: 'lastSeen',
        header: t('col.lastSeen'),
        cell: (row) => formatDateTime(row.lastSeenAt, i18n.language, timeZone),
      },
      {
        id: 'expires',
        header: t('col.expires'),
        cell: (row) => formatDateTime(row.expiresAt, i18n.language, timeZone),
      },
    ],
    [t, i18n.language, timeZone],
  );

  return (
    <DataTable<SessionSummary>
      caption={t('caption')}
      columns={columns}
      rows={sessions}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={10}
      onLimitChange={() => undefined}
      pagination={{
        hasPrevious: false,
        hasNext: false,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }}
      hidePagination
      refreshing={refreshing}
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) =>
        row.current ? null : (
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('action.closeLabel', {
              device: describeDevice(row.userAgent) ?? t('device.unknown'),
            })}
            onClick={() => {
              onClose(row);
            }}
          >
            {t('action.close')}
          </Button>
        )
      }
    />
  );
}
