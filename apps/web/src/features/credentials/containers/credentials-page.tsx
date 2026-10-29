import type { Credential } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import {
  credentialsKeys,
  fetchAccount,
  fetchCredentials,
  fetchCredentialUsername,
} from '../api/credentials-api';
import {
  canChangePassword,
  canCopyUsername,
  canCreateCredential,
  canRevealPassword,
  canViewHistory,
} from '../model/credential-access';
import { CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_SECONDS } from '../model/secret-policy';
import { CredentialsTable } from '../ui/credentials-table';

import { ChangePasswordDialog } from './change-password-dialog';
import { CreateCredentialDialog } from './create-credential-dialog';
import { HistoryDialog } from './history-dialog';
import { RevealPasswordDialog } from './reveal-password-dialog';
import { copySecretWithAutoClear } from './secret-clipboard';

type DialogState =
  { kind: 'create' } | { kind: 'reveal' | 'password' | 'history'; credential: Credential } | null;

export type CredentialsPageProps = {
  accountId: string;
};

/**
 * Container de `/accounts/:accountId/credentials`: las credenciales de una cuenta con la
 * `DataTable` estándar. Las acciones se ofrecen según el permiso y el `myLevel` de la cuenta
 * (USE copiar usuario, VIEW revelar, EDIT crear, cambiar contraseña e historial); solo es
 * comodidad, el servidor decide siempre.
 */
export function CredentialsPage({ accountId }: CredentialsPageProps) {
  const catalogReady = useLazyCatalog('credentials');
  const { t } = useTranslation(['credentials', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const hasCreatePermission = usePermission('credential.create');
  const hasUpdatePermission = usePermission('credential.update');
  const hasRevealPermission = usePermission('credential.reveal_password');
  const [dialog, setDialog] = useState<DialogState>(null);

  const accountQuery = useQuery({
    queryKey: credentialsKeys.account(accountId),
    queryFn: ({ signal }) => fetchAccount(accountId, signal),
    staleTime: 0,
  });
  const credentialsQuery = useQuery({
    queryKey: credentialsKeys.list(accountId),
    queryFn: ({ signal }) => fetchCredentials(accountId, signal),
    staleTime: 0,
  });

  // El usuario pasa por una variable local y va directo al portapapeles: no se guarda en estado.
  const copyUsername = useAsyncAction(async (credential: Credential) => {
    const username = await fetchCredentialUsername(credential.id);
    return copySecretWithAutoClear(username, CLIPBOARD_CLEAR_MS);
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const backLink = (
    <Link
      to="/accounts"
      className="inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-4"
    >
      {t('back', { ns: 'credentials' })}
    </Link>
  );

  if (accountQuery.isPending) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }
  if (accountQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorAlert
          error={accountQuery.error}
          onRetry={() => {
            void accountQuery.refetch();
          }}
        />
      </div>
    );
  }

  const account = accountQuery.data;
  const myLevel = account.myLevel;
  const allowCreate = canCreateCredential(hasCreatePermission, myLevel);

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: credentialsKeys.list(accountId) });
  };

  async function handleCopyUsername(credential: Credential) {
    const result = await copyUsername.run(credential);
    if (!result.ok) return;
    if (result.value) {
      toast.show(
        t('copyUsername.copied', { ns: 'credentials', seconds: CLIPBOARD_CLEAR_SECONDS }),
        'success',
      );
    } else {
      toast.show(t('clipboard.failed', { ns: 'common' }), 'danger');
    }
  }

  const tableStatus = credentialsQuery.isPending
    ? 'loading'
    : credentialsQuery.isError
      ? 'error'
      : 'success';

  return (
    <>
      {backLink}
      <PageHeader
        title={t('title', { ns: 'credentials', name: account.displayName })}
        description={t('description', { ns: 'credentials' })}
        actions={
          allowCreate ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'create' });
              }}
            >
              {t('action.create', { ns: 'credentials' })}
            </Button>
          ) : undefined
        }
      />
      {copyUsername.error !== undefined ? <ErrorAlert error={copyUsername.error} /> : null}
      <CredentialsTable
        credentials={credentialsQuery.data ?? []}
        status={tableStatus}
        errorMessage={errorMessage(credentialsQuery.error)}
        onRetry={() => {
          void credentialsQuery.refetch();
        }}
        timeZone={timeZone}
        canCopyUsername={canCopyUsername(myLevel)}
        canReveal={canRevealPassword(hasRevealPermission, myLevel)}
        canChangePassword={canChangePassword(hasUpdatePermission, myLevel)}
        canViewHistory={canViewHistory(myLevel)}
        onCopyUsername={(credential) => {
          void handleCopyUsername(credential);
        }}
        onReveal={(credential) => {
          setDialog({ kind: 'reveal', credential });
        }}
        onChangePassword={(credential) => {
          setDialog({ kind: 'password', credential });
        }}
        onViewHistory={(credential) => {
          setDialog({ kind: 'history', credential });
        }}
      />
      {allowCreate ? (
        <CreateCredentialDialog
          accountId={accountId}
          open={dialog?.kind === 'create'}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onCreated={(label) => {
            toast.show(t('create.toast', { ns: 'credentials', label }), 'success');
            close();
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'reveal' ? (
        <RevealPasswordDialog credential={dialog.credential} onClose={close} />
      ) : null}
      {dialog?.kind === 'password' ? (
        <ChangePasswordDialog
          credential={dialog.credential}
          onClose={close}
          onChanged={() => {
            toast.show(
              t('password.toast', { ns: 'credentials', label: dialog.credential.label }),
              'success',
            );
            close();
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <HistoryDialog credential={dialog.credential} onClose={close} />
      ) : null}
    </>
  );
}
