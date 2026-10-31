import {
  ErrorCode,
  type CreateInvitationWithLinkResponse,
  type PendingInvitation,
} from '@iam/contracts';
import { Dialog } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  useAsyncAction,
  useFixedOrderTable,
  useRateLimitCooldown,
} from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import {
  directoryKeys,
  fetchPendingInvitationsPage,
  resendInvitation,
  resendInvitationWithLink,
} from '../api/directory-api';
import { InvitationLinkPanel } from '../ui/invitation-link-panel';
import { InvitationsTable } from '../ui/invitations-table';

/**
 * Pestaña "Invitaciones": las invitaciones pendientes con la `DataTable` estándar y la acción
 * "Reenviar" por fila. Reenviar no pide confirmación (no destruye nada: solo cambia el enlace).
 * Con el permiso `user.invite_link` ofrece además "Reenviar y ver enlace", que muestra el enlace
 * nuevo en un diálogo.
 */
export function InvitationsPanel() {
  const { t } = useTranslation('directory');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const [resendingId, setResendingId] = useState<string | null>(null);
  const resend = useAsyncAction((invitation: PendingInvitation) => resendInvitation(invitation.id));
  // Reenvío con enlace: `useAsyncAction` (no `useMutation`) para que la respuesta con el enlace no
  // pase por la caché de Query (docs/frontend.md §9).
  const resendWithLink = useAsyncAction((invitation: PendingInvitation) =>
    resendInvitationWithLink(invitation.id),
  );
  const canShowLink = usePermission('user.invite_link');
  // El enlace vive solo aquí y se descarta al cerrar el diálogo; para verlo otra vez hay que reenviar.
  const [linkInvitation, setLinkInvitation] = useState<CreateInvitationWithLinkResponse | null>(
    null,
  );
  const resendError: unknown = resend.error ?? resendWithLink.error;
  const cooldown = useRateLimitCooldown(resendError);

  // Otra persona (o la Raíz) puede haberla aceptado o reenviado: se recarga al volver.
  const table = useFixedOrderTable({
    queryKey: directoryKeys.invitations(),
    fetchPage: fetchPendingInvitationsPage,
  });

  async function onResend(invitation: PendingInvitation) {
    // 429: no se reenvía mientras corre la espera que ya muestra el aviso.
    if (cooldown.secondsLeft > 0) return;
    setResendingId(invitation.id);
    resendWithLink.reset();
    const result = await resend.run(invitation);
    setResendingId(null);
    if (result.ok) toast.show(t('invitations.resent', { email: invitation.email }), 'success');
    // INVALID: ya se aceptó o se revocó y la fila sobra; el error se muestra y la lista se actualiza.
    const gone =
      !result.ok &&
      result.error instanceof ApiError &&
      result.error.code === ErrorCode.INVITATION_INVALID;
    if (result.ok || gone) {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.invitations() });
    }
  }

  async function onResendWithLink(invitation: PendingInvitation) {
    if (cooldown.secondsLeft > 0) return;
    setResendingId(invitation.id);
    resend.reset();
    const result = await resendWithLink.run(invitation);
    setResendingId(null);
    if (result.ok) setLinkInvitation(result.value);
    // Reenviar revoca el enlace anterior: la lista cambia aunque la respuesta fuera un error por
    // una invitación que ya no existe.
    const gone =
      !result.ok &&
      result.error instanceof ApiError &&
      result.error.code === ErrorCode.INVITATION_INVALID;
    if (result.ok || gone) {
      void queryClient.invalidateQueries({ queryKey: directoryKeys.invitations() });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {resendError !== undefined ? (
        <ErrorAlert error={resendError} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <InvitationsTable
        invitations={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        onResend={(invitation) => {
          void onResend(invitation);
        }}
        {...(canShowLink
          ? {
              onResendWithLink: (invitation: PendingInvitation) => {
                void onResendWithLink(invitation);
              },
            }
          : {})}
        resendingId={resendingId}
        timeZone={timeZone}
        refreshing={table.refreshing}
        paging={table}
      />
      {linkInvitation !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setLinkInvitation(null);
          }}
          title={t('link.title')}
          description={t('link.description', { email: linkInvitation.email })}
          closeLabel={t('dialog.close', { ns: 'common' })}
        >
          <InvitationLinkPanel
            invitation={linkInvitation}
            timeZone={timeZone}
            onClose={() => {
              setLinkInvitation(null);
            }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
