import type { Passkey } from '@iam/contracts';
import { Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

export type PasskeysTableProps = {
  passkeys: Passkey[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onRemove: (passkey: Passkey) => void;
  /** Zona horaria del perfil, para mostrar las fechas. */
  timeZone: string | undefined;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
  /** Acción sugerida del estado vacío (agregar passkey), si el navegador la admite. */
  emptyAction?: ReactNode;
};

/**
 * Tabla estándar de las passkeys propias. Presentacional: solo recibe el listado que entrega el
 * servidor (nombre y fechas; nunca llaves) y avisa qué fila se quiere quitar.
 */
export function PasskeysTable({
  passkeys,
  status,
  errorMessage,
  onRetry,
  onRemove,
  timeZone,
  refreshing,
  emptyAction,
}: PasskeysTableProps) {
  const { t, i18n } = useTranslation('security');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<Passkey>[]>(
    () => [
      { id: 'name', header: t('col.name'), cell: (row) => row.name },
      {
        id: 'created',
        header: t('col.created'),
        cell: (row) => formatDateTime(row.createdAt, i18n.language, timeZone),
      },
      {
        id: 'lastUsed',
        header: t('col.lastUsed'),
        cell: (row) =>
          row.lastUsedAt === null
            ? t('lastUsed.never')
            : formatDateTime(row.lastUsedAt, i18n.language, timeZone),
      },
    ],
    [t, i18n.language, timeZone],
  );

  return (
    <DataTable<Passkey>
      caption={t('caption')}
      columns={columns}
      rows={passkeys}
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
      emptyState={
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          {...(emptyAction !== undefined ? { action: emptyAction } : {})}
        />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('action.removeLabel', { name: row.name })}
          onClick={() => {
            onRemove(row);
          }}
        >
          {t('action.remove')}
        </Button>
      )}
    />
  );
}
