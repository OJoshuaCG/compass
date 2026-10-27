import { ErrorCode, type PendingInvitation } from '@iam/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { directoryKeys, fetchPendingInvitations, resendInvitation } from '../api/directory-api';
import { InvitationsTable } from '../ui/invitations-table';

/**
 * Pestaña "Invitaciones": las invitaciones pendientes con la `DataTable` estándar y la acción
 * "Reenviar" por fila. Reenviar no pide confirmación (no destruye nada: solo cambia el enlace).
 */
export function InvitationsPanel() {
  const { t } = useTranslation('directory');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const [resendingId, setResendingId] = useState<string | null>(null);
  const resend = useAsyncAction((invitation: PendingInvitation) => resendInvitation(invitation.id));

  const query = useQuery({
    queryKey: directoryKeys.invitations(),
    queryFn: ({ signal }) => fetchPendingInvitations(signal),
    // Otra persona (o la Raíz) puede haberla aceptado o reenviado: se recarga al volver.
    staleTime: 0,
  });

  async function onResend(invitation: PendingInvitation) {
    setResendingId(invitation.id);
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

  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';

  return (
    <div className="flex flex-col gap-4">
      {resend.error !== undefined ? <ErrorAlert error={resend.error} /> : null}
      <InvitationsTable
        invitations={query.data ?? []}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        onResend={(invitation) => {
          void onResend(invitation);
        }}
        resendingId={resendingId}
        timeZone={timeZone}
        refreshing={query.isFetching && !query.isPending}
      />
    </div>
  );
}
