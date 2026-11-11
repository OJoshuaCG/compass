import type { RootTransfer } from '@iam/contracts';
import { Alert, Button, Card, CardBody, PageHeader, Spinner, type Status } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { formatDateTime } from '../../../shared/lib';
import { useToast } from '../../../shared/toast';
import {
  fetchCurrentRootTransfer,
  fetchLeadership,
  rootTransferKeys,
} from '../api/root-transfer-api';
import {
  canAccept,
  canPropose,
  eligibleTargets,
  personName,
  rootTransferViewer,
} from '../model/root-transfer-model';
import { RootTransferSummary, type RootTransferSummaryItem } from '../ui/root-transfer-summary';

import { ProposeRootTransferForm } from './propose-root-transfer-form';
import { AcceptRootTransferDialog, CancelRootTransferDialog } from './root-transfer-dialogs';

const STATUS_TONE: Record<RootTransfer['status'], Status> = {
  pending_acceptance: 'info',
  waiting: 'warning',
};

type OpenDialog = 'accept' | 'cancel' | null;

/**
 * Container de `/root-transfer`: proponer, aceptar o cancelar el traspaso de la Raíz (ADR 0048).
 * El rango lo comprueba la ruta como comodidad; el servidor decide siempre y la aceptación y la
 * propuesta exigen reautenticación reciente, que abre el cliente HTTP base.
 */
export function RootTransferPage() {
  const catalogReady = useLazyCatalog('directory');
  const { t, i18n } = useTranslation(['directory', 'common', 'errors']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);

  // Siempre se recarga al volver: otra persona pudo aceptar o cancelar desde otra sesión.
  const current = useQuery({
    queryKey: rootTransferKeys.current(),
    queryFn: ({ signal }) => fetchCurrentRootTransfer(signal),
    staleTime: 0,
  });
  const leadership = useQuery({
    queryKey: rootTransferKeys.leadership(),
    queryFn: ({ signal }) => fetchLeadership(signal),
    staleTime: 30_000,
  });

  if (!catalogReady || me === undefined || current.isPending) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }

  const header = (
    <PageHeader
      eyebrow={t('nav.group.access', { ns: 'common' })}
      title={t('rootTransfer.title')}
      description={t('rootTransfer.description')}
    />
  );

  if (current.isError) {
    return (
      <>
        {header}
        <ErrorAlert
          error={current.error}
          onRetry={() => {
            void current.refetch();
          }}
        />
      </>
    );
  }

  const transfer = current.data;
  const people = leadership.data ?? [];
  const viewer = rootTransferViewer(me.user.rank, me.user.id, transfer);
  const timeZone = me.user.timezone;
  const when = (iso: string) => formatDateTime(iso, i18n.language, timeZone);
  const nameOf = (id: string) => personName(people, id) ?? t('rootTransfer.unknownPerson');

  function showTransfer(next: RootTransfer | null) {
    queryClient.setQueryData(rootTransferKeys.current(), next);
  }

  function summaryItems(open: RootTransfer): RootTransferSummaryItem[] {
    const items: RootTransferSummaryItem[] = [
      { label: t('rootTransfer.field.from'), value: nameOf(open.fromUserId) },
      { label: t('rootTransfer.field.to'), value: nameOf(open.toUserId) },
      { label: t('rootTransfer.field.requestedAt'), value: when(open.requestedAt) },
    ];
    if (open.acceptedAt === null) {
      items.push({ label: t('rootTransfer.field.expiresAt'), value: when(open.expiresAt) });
    } else {
      items.push({ label: t('rootTransfer.field.acceptedAt'), value: when(open.acceptedAt) });
    }
    if (open.executesAt !== null) {
      items.push({ label: t('rootTransfer.field.executesAt'), value: when(open.executesAt) });
    }
    return items;
  }

  return (
    <>
      {header}
      <div className="mt-6 flex max-w-2xl flex-col gap-4">
        <p className="text-sm text-text-secondary">{t('rootTransfer.rules')}</p>
        <Alert tone="warning">{t('rootTransfer.effects')}</Alert>
        {leadership.isError ? (
          <ErrorAlert
            error={leadership.error}
            onRetry={() => {
              void leadership.refetch();
            }}
          />
        ) : null}

        {transfer === null ? (
          <Card>
            <CardBody>
              {canPropose(viewer, transfer) ? (
                <ProposeRootTransferForm
                  candidates={eligibleTargets(people, me.user.id)}
                  onProposed={(proposed, targetName) => {
                    showTransfer(proposed);
                    toast.show(t('rootTransfer.proposed', { name: targetName }), 'success');
                  }}
                />
              ) : (
                <p className="text-sm text-text-secondary">{t('rootTransfer.none')}</p>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            <RootTransferSummary
              status={STATUS_TONE[transfer.status]}
              statusLabel={t(`rootTransfer.status.${transfer.status}`)}
              items={summaryItems(transfer)}
            />
            {canAccept(viewer, transfer) ? (
              <Alert tone="info">{t('rootTransfer.recipientNotice')}</Alert>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              {canAccept(viewer, transfer) ? (
                <Button
                  onClick={() => {
                    setOpenDialog('accept');
                  }}
                >
                  {t('rootTransfer.accept.action')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setOpenDialog('cancel');
                }}
              >
                {t('rootTransfer.cancel.action')}
              </Button>
            </div>
          </>
        )}
      </div>

      {openDialog === 'accept' ? (
        <AcceptRootTransferDialog
          onClose={() => {
            setOpenDialog(null);
          }}
          onAccepted={(accepted) => {
            setOpenDialog(null);
            showTransfer(accepted);
            toast.show(t('rootTransfer.accepted'), 'success');
          }}
          onGone={() => {
            setOpenDialog(null);
            showTransfer(null);
          }}
        />
      ) : null}
      {openDialog === 'cancel' ? (
        <CancelRootTransferDialog
          onClose={() => {
            setOpenDialog(null);
          }}
          onCancelled={() => {
            setOpenDialog(null);
            showTransfer(null);
            toast.show(t('rootTransfer.cancelled'), 'success');
          }}
        />
      ) : null}
    </>
  );
}
