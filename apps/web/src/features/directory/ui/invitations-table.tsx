import type { PendingInvitation } from '@iam/contracts';
import { Button, DataTable, EmptyState, StatusBadge, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

export type InvitationsTableProps = {
  invitations: PendingInvitation[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onResend: (invitation: PendingInvitation) => void;
  /** Invitación que se está reenviando: su botón queda en carga y los demás deshabilitados. */
  resendingId: string | null;
  /** Zona horaria del perfil, para mostrar las fechas. */
  timeZone: string | undefined;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
  /** Tamaño y navegación de página que entrega el container. */
  paging: TablePaging;
};

/**
 * Tabla estándar de invitaciones pendientes. Presentacional: el container carga y reenvía. Una
 * vencida sigue siendo pendiente (se puede reenviar), por eso el estado es Pendiente o Vencida.
 */
export function InvitationsTable({
  invitations,
  status,
  errorMessage,
  onRetry,
  onResend,
  resendingId,
  timeZone,
  refreshing,
  paging,
}: InvitationsTableProps) {
  const { t, i18n } = useTranslation(['directory', 'common']);
  const labels = useDataTableLabels();

  const columns = useMemo<Column<PendingInvitation>[]>(
    () => [
      {
        id: 'email',
        header: t('users.col.email', { ns: 'directory' }),
        cell: (row) => row.email,
      },
      {
        id: 'rank',
        header: t('users.col.rank', { ns: 'directory' }),
        cell: (row) => t(`rank.${String(row.rank)}`, { ns: 'common' }),
      },
      {
        id: 'sent',
        header: t('invitations.col.sent', { ns: 'directory' }),
        cell: (row) => formatDateTime(row.createdAt, i18n.language, timeZone),
      },
      {
        id: 'expires',
        header: t('invitations.col.expires', { ns: 'directory' }),
        cell: (row) => formatDateTime(row.expiresAt, i18n.language, timeZone),
      },
      {
        id: 'status',
        header: t('invitations.col.status', { ns: 'directory' }),
        cell: (row) => (
          <StatusBadge
            status={row.expired ? 'warning' : 'info'}
            label={t(row.expired ? 'invitations.status.expired' : 'invitations.status.pending', {
              ns: 'directory',
            })}
          />
        ),
      },
    ],
    [t, i18n.language, timeZone],
  );

  return (
    <DataTable<PendingInvitation>
      caption={t('invitations.caption', { ns: 'directory' })}
      columns={columns}
      rows={invitations}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      refreshing={refreshing}
      labels={labels}
      emptyState={
        <EmptyState
          title={t('invitations.empty.title', { ns: 'directory' })}
          description={t('invitations.empty.description', { ns: 'directory' })}
        />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <Button
          variant="secondary"
          size="sm"
          loading={resendingId === row.id}
          disabled={resendingId !== null}
          aria-label={t('invitations.resendLabel', { ns: 'directory', email: row.email })}
          onClick={() => {
            onResend(row);
          }}
        >
          {t('invitations.resend', { ns: 'directory' })}
        </Button>
      )}
    />
  );
}
