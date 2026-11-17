import { Badge, Button, ConfirmDialog } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import {
  fetchInboundMailDeleteStatus,
  inboundKeys,
  requestInboundMailDelete,
} from '../api/inbound-api';
import {
  canRequestMailDelete,
  isMailDeleteSettled,
  MAIL_DELETE_POLL_INTERVAL_MS,
  MAIL_DELETE_POLL_MAX_MS,
  type MailDeleteState,
} from '../model/inbound-mail-delete-policy';

export type InboundMailDeleteCellProps = {
  receiptId: string;
  /** Texto con el que se nombra el mensaje (fecha de recepción) en los nombres accesibles. */
  receivedAtLabel: string;
};

/**
 * Acción «Borrar correo del buzón» de una fila del historial. Solo tras pedirlo en esta sesión se
 * consulta el estado, y se hace hasta que termine o venza el tope; no hay reintentos a ciegas. El
 * estado son ids y estados (sin secretos), pero igual vive solo en la caché en memoria de Query.
 */
export function InboundMailDeleteCell({ receiptId, receivedAtLabel }: InboundMailDeleteCellProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Instante (ms) en que se pidió en esta sesión; `undefined` = aún no se pidió, no se consulta.
  const [pollingSince, setPollingSince] = useState<number | undefined>(undefined);
  const [pollExpired, setPollExpired] = useState(false);
  const statusRef = useRef<HTMLSpanElement>(null);
  const focusStatusNext = useRef(false);

  const action = useAsyncAction(() => requestInboundMailDelete(receiptId));
  const cooldown = useRateLimitCooldown(action.error);
  const queryKey = inboundKeys.mailDelete(receiptId);

  const statusQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchInboundMailDeleteStatus(receiptId, signal),
    enabled: pollingSince !== undefined,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => {
      if (pollingSince === undefined) return false;
      if (query.state.status === 'error') return false;
      if (isMailDeleteSettled(query.state.data?.data)) return false;
      if (Date.now() - pollingSince >= MAIL_DELETE_POLL_MAX_MS) return false;
      return MAIL_DELETE_POLL_INTERVAL_MS;
    },
  });

  const state: MailDeleteState | null | undefined = statusQuery.data?.data;
  const requested = pollingSince !== undefined;
  const settled = isMailDeleteSettled(state);

  // Vencido el tope sin terminar se avisa; el temporizador se cancela si termina antes.
  useEffect(() => {
    if (pollingSince === undefined || settled) return;
    const remaining = MAIL_DELETE_POLL_MAX_MS - (Date.now() - pollingSince);
    const timer = window.setTimeout(
      () => {
        setPollExpired(true);
      },
      Math.max(remaining, 0),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [pollingSince, settled]);

  // Al confirmar, el botón se desmonta (pasa a «Pendiente»): el foco va al estado, no a <body> (WCAG 2.4.3).
  useEffect(() => {
    if (!focusStatusNext.current || !requested) return;
    focusStatusNext.current = false;
    statusRef.current?.focus();
  }, [requested, pollingSince]);

  function startPolling() {
    // Estado inicial «pendiente» sin esperar al primer GET; el servidor lo confirma al consultar.
    const pending: MailDeleteState = {
      status: 'pending',
      resultCode: null,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    };
    queryClient.setQueryData(queryKey, { data: pending });
    setPollExpired(false);
    focusStatusNext.current = true;
    setPollingSince(Date.now());
  }

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (!result.ok) return;
    setDialogOpen(false);
    startPolling();
  }

  function closeDialog() {
    action.reset();
    setDialogOpen(false);
  }

  const showButton = !requested || canRequestMailDelete(state);
  const pendingNow = requested && !settled && statusQuery.status !== 'error' && !pollExpired;
  const failureCode = state?.status === 'failed' ? (state.resultCode ?? 'UNEXPECTED') : undefined;

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Región viva siempre presente: los cambios de estado se anuncian sin mover el foco. */}
      <span
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className="flex flex-col items-end gap-1 text-sm text-text-secondary"
      >
        {pendingNow ? (
          <Badge dot tone="warning">
            {t('mailDelete.status.pending')}
          </Badge>
        ) : null}
        {requested && !settled && pollExpired && statusQuery.status !== 'error' ? (
          <span>{t('mailDelete.status.slow')}</span>
        ) : null}
        {state?.status === 'done' ? (
          <Badge dot tone="success">
            {t('mailDelete.status.done')}
          </Badge>
        ) : null}
        {failureCode !== undefined ? (
          <>
            <Badge dot tone="danger">
              {t('mailDelete.status.failed')}
            </Badge>
            <span className="max-w-xs text-end">{t(`mailDelete.result.${failureCode}`)}</span>
          </>
        ) : null}
        {statusQuery.status === 'error' ? (
          <span className="max-w-xs text-end">
            {t('mailDelete.status.queryFailed', { message: errorMessage(statusQuery.error) })}
          </span>
        ) : null}
      </span>
      {statusQuery.status === 'error' ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('mailDelete.recheckLabel', { received: receivedAtLabel })}
          onClick={() => {
            setPollExpired(false);
            setPollingSince(Date.now());
            void statusQuery.refetch();
          }}
        >
          {t('mailDelete.recheck')}
        </Button>
      ) : null}
      {showButton ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('mailDelete.openLabel', { received: receivedAtLabel })}
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          {t('mailDelete.open')}
        </Button>
      ) : null}
      {dialogOpen ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          title={t('mailDelete.dialog.title', { received: receivedAtLabel })}
          description={t('mailDelete.dialog.description')}
          confirmLabel={t('mailDelete.dialog.confirm')}
          cancelLabel={t('actions.cancel', { ns: 'common' })}
          tone="danger"
          loading={action.pending}
          confirmDisabled={cooldown.secondsLeft > 0}
          onConfirm={() => {
            void confirm();
          }}
        >
          <div className="flex flex-col gap-3">
            <ul className="list-disc space-y-1 ps-5 text-sm text-text-secondary">
              <li>{t('mailDelete.dialog.irreversible')}</li>
              <li>{t('mailDelete.dialog.realMailbox')}</li>
              <li>{t('mailDelete.dialog.notImmediate')}</li>
              <li>{t('mailDelete.dialog.audited')}</li>
            </ul>
            {action.error !== undefined ? (
              <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
