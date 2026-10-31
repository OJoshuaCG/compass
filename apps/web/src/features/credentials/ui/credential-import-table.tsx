import type { CredentialImportRow, CredentialImportRowStatus } from '@iam/contracts';
import {
  DataTable,
  EmptyState,
  StatusBadge,
  type Column,
  type PageLimit,
  type Status,
} from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';

const STATUS_TONE: Record<CredentialImportRowStatus, Status> = {
  valid: 'success',
  invalid: 'danger',
  // Un duplicado no es un error: se omite al confirmar, por eso no usa el tono de peligro.
  duplicate: 'info',
};

const NO_OP = () => undefined;

export type CredentialImportTableProps = {
  /** Solo las filas de la página actual: la paginación en memoria la lleva el container. */
  rows: CredentialImportRow[];
  limit: PageLimit;
  onLimitChange: (limit: PageLimit) => void;
  /** Filas totales del archivo y filas de páginas anteriores, para el rango del pie. */
  total: number;
  offset: number;
  onPrevious: () => void;
  onNext: () => void;
};

/**
 * Tabla estándar de la previsualización. Presentacional y sin secretos: el contrato solo devuelve
 * línea, plataforma, cuenta, etiqueta, estado y códigos; el usuario y la contraseña nunca llegan
 * aquí. El estado se comunica con ícono y texto, no solo con color.
 */
export function CredentialImportTable({
  rows,
  limit,
  onLimitChange,
  total,
  offset,
  onPrevious,
  onNext,
}: CredentialImportTableProps) {
  const { t } = useTranslation('credentials');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<CredentialImportRow>[]>(
    () => [
      { id: 'line', header: t('import.col.line'), cell: (row) => row.line },
      { id: 'platform', header: t('import.col.platform'), cell: (row) => row.platform },
      { id: 'account', header: t('import.col.account'), cell: (row) => row.accountName },
      { id: 'label', header: t('import.col.label'), cell: (row) => row.credentialLabel },
      {
        id: 'status',
        header: t('import.col.status'),
        cell: (row) => (
          <StatusBadge status={STATUS_TONE[row.status]} label={t(`import.status.${row.status}`)} />
        ),
      },
      {
        id: 'details',
        header: t('import.col.details'),
        cell: (row) => (
          <>
            {row.errorCodes.length > 0 ? (
              <ul className="list-disc ps-4">
                {row.errorCodes.map((code, index) => (
                  // El índice evita claves repetidas si el servidor repite un código en la fila.
                  <li key={`${code}-${String(index)}`}>{t(`import.rowError.${code}`)}</li>
                ))}
              </ul>
            ) : null}
            {row.duplicateReason !== null ? t(`import.duplicate.${row.duplicateReason}`) : null}
          </>
        ),
      },
    ],
    [t],
  );

  return (
    <DataTable<CredentialImportRow>
      caption={t('import.table.caption')}
      columns={columns}
      rows={rows}
      getRowId={(row) => String(row.line)}
      status="success"
      onSortChange={NO_OP}
      limit={limit}
      onLimitChange={onLimitChange}
      pagination={{
        hasPrevious: offset > 0,
        hasNext: offset + limit < total,
        onPrevious,
        onNext,
        total,
        offset,
      }}
      labels={labels}
      emptyState={
        <EmptyState
          title={t('import.table.empty.title')}
          description={t('import.table.empty.description')}
        />
      }
    />
  );
}
