import { DEFAULT_PAGE_LIMIT, type Credential } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

export type CredentialsTableProps = {
  credentials: Credential[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Zona horaria del perfil, para las fechas. */
  timeZone: string | undefined;
  /** Decisiones de comodidad (permiso + nivel) que toma el container; el servidor decide siempre. */
  canCopyUsername: boolean;
  canReveal: boolean;
  canChangePassword: boolean;
  canViewHistory: boolean;
  onCopyUsername: (credential: Credential) => void;
  onReveal: (credential: Credential) => void;
  onChangePassword: (credential: Credential) => void;
  onViewHistory: (credential: Credential) => void;
};

const NO_OP = () => undefined;

/**
 * Tabla estándar de credenciales. Presentacional: nunca recibe usuario ni contraseña, solo los
 * metadatos del listado. Las acciones aparecen según lo que el container dice que la cuenta admite.
 * El listado llega completo (sin cursor), así que se omite el pie de paginación.
 */
export function CredentialsTable({
  credentials,
  status,
  errorMessage,
  onRetry,
  timeZone,
  canCopyUsername,
  canReveal,
  canChangePassword,
  canViewHistory,
  onCopyUsername,
  onReveal,
  onChangePassword,
  onViewHistory,
}: CredentialsTableProps) {
  const { t, i18n } = useTranslation('credentials');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<Credential>[]>(
    () => [
      { id: 'label', header: t('col.label'), cell: (row) => row.label },
      { id: 'kind', header: t('col.kind'), cell: (row) => <Badge>{t(`kind.${row.kind}`)}</Badge> },
      {
        id: 'lastRotated',
        header: t('col.lastRotated'),
        cell: (row) =>
          row.lastRotatedAt === null
            ? t('rotated.never')
            : formatDateTime(row.lastRotatedAt, i18n.language, timeZone),
      },
    ],
    [i18n.language, t, timeZone],
  );

  const hasAnyAction = canCopyUsername || canReveal || canChangePassword || canViewHistory;

  return (
    <DataTable<Credential>
      caption={t('caption')}
      columns={columns}
      rows={credentials}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={DEFAULT_PAGE_LIMIT}
      onLimitChange={NO_OP}
      pagination={{ hasPrevious: false, hasNext: false, onPrevious: NO_OP, onNext: NO_OP }}
      hidePagination
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={
        hasAnyAction
          ? (row) => (
              <span className="flex flex-wrap justify-end gap-2">
                {canCopyUsername ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.copyUsernameLabel', { label: row.label })}
                    onClick={() => {
                      onCopyUsername(row);
                    }}
                  >
                    {t('action.copyUsername')}
                  </Button>
                ) : null}
                {canReveal ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.revealLabel', { label: row.label })}
                    onClick={() => {
                      onReveal(row);
                    }}
                  >
                    {t('action.reveal')}
                  </Button>
                ) : null}
                {canChangePassword ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.changePasswordLabel', { label: row.label })}
                    onClick={() => {
                      onChangePassword(row);
                    }}
                  >
                    {t('action.changePassword')}
                  </Button>
                ) : null}
                {canViewHistory ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('action.historyLabel', { label: row.label })}
                    onClick={() => {
                      onViewHistory(row);
                    }}
                  >
                    {t('action.history')}
                  </Button>
                ) : null}
              </span>
            )
          : undefined
      }
    />
  );
}
