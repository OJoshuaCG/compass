import type { PendingInvitation } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, UserPlus, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

/** Una invitación vigente que vence antes de esto se marca como "por vencer". */
const EXPIRING_SOON_MS = 48 * 60 * 60 * 1000;

export type InvitationsTableProps = {
  invitations: PendingInvitation[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onResend: (invitation: PendingInvitation) => void;
  /** Reenviar y mostrar el enlace. Solo se ofrece el botón si el container lo pasa (permiso). */
  onResendWithLink?: (invitation: PendingInvitation) => void;
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
  onResendWithLink,
  resendingId,
  timeZone,
  refreshing,
  paging,
}: InvitationsTableProps) {
  const { t, i18n } = useTranslation(['directory', 'common']);
  const labels = useDataTableLabels();

  // Como el diseño de Compass: la persona invitada con su rango y la fecha de envío en una sola
  // columna, y el vencimiento como insignia (rojo si venció, ámbar si vence en menos de 48 h).
  const columns = useMemo<Column<PendingInvitation>[]>(() => {
    const now = Date.now();
    return [
      {
        id: 'email',
        header: t('invitations.col.person', { ns: 'directory' }),
        cell: (row) => (
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-accent"
            >
              <UserPlus className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold text-text">{row.email}</span>
              <span className="text-xs text-text-muted">
                <span>{t(`rank.${String(row.rank)}`, { ns: 'common' })}</span>
                {' · '}
                {t('invitations.sentOn', {
                  ns: 'directory',
                  date: formatDateTime(row.createdAt, i18n.language, timeZone),
                })}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('invitations.col.status', { ns: 'directory' }),
        cell: (row) => {
          if (row.expired) {
            return (
              <Badge tone="danger">{t('invitations.status.expired', { ns: 'directory' })}</Badge>
            );
          }
          const soon = Date.parse(row.expiresAt) - now < EXPIRING_SOON_MS;
          return (
            <Badge tone={soon ? 'warning' : 'accent'}>
              {t('invitations.expiresOn', {
                ns: 'directory',
                date: formatDateTime(row.expiresAt, i18n.language, timeZone),
              })}
            </Badge>
          );
        },
      },
    ];
  }, [t, i18n.language, timeZone]);

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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          {onResendWithLink !== undefined ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={resendingId !== null}
              aria-label={t('invitations.resendWithLinkLabel', {
                ns: 'directory',
                email: row.email,
              })}
              onClick={() => {
                onResendWithLink(row);
              }}
            >
              {t('invitations.resendWithLink', { ns: 'directory' })}
            </Button>
          ) : null}
        </div>
      )}
    />
  );
}
