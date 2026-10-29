import type { Credential } from '@iam/contracts';
import { Button, PageHeader, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  canEditTotp,
  canExportTotp,
  canRevealPassword,
  canUseTotp,
  canViewHistory,
} from '../model/credential-access';
import { CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_SECONDS } from '../model/secret-policy';
import { CredentialsTable, rowMenuTriggerSelector } from '../ui/credentials-table';

import { ChangePasswordDialog } from './change-password-dialog';
import { CreateCredentialDialog } from './create-credential-dialog';
import { HistoryDialog } from './history-dialog';
import { RevealPasswordDialog } from './reveal-password-dialog';
import { copySecretWithAutoClear } from './secret-clipboard';
import { TotpDialog } from './totp-dialog';

type DialogState =
  | { kind: 'create' }
  | { kind: 'reveal' | 'password' | 'history' | 'totp'; credential: Credential }
  | null;

export type CredentialsPageProps = {
  accountId: string;
};

/**
 * Container de `/accounts/:accountId/credentials`: las credenciales de una cuenta con la
 * `DataTable` estándar. Las acciones se ofrecen según el permiso y el `myLevel` de la cuenta
 * (USE copiar usuario y segundo factor, VIEW revelar, EDIT crear, cambiar contraseña, historial y
 * registrar o retirar el segundo factor, MANAGE exportar su clave); solo es
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
  const hasUseTotpPermission = usePermission('credential.use_totp');
  const hasExportTotpPermission = usePermission('credential.export_totp');
  const [dialog, setDialog] = useState<DialogState>(null);
  // Fila cuyo menú "⋯" abrió el diálogo actual; sirve para devolver el foco al cerrarlo.
  const menuOriginRef = useRef<string | null>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);

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

  // Un diálogo abierto desde el menú de fila puede cerrarse con el foco en un elemento ya
  // desmontado (el ítem del menú), y el foco se pierde en <body>. Al cerrar, si pasó eso, se
  // devuelve al disparador del menú de esa fila o, si la fila ya no existe, a la región de la
  // tabla (WCAG 2.4.3). El temporizador deja que Radix termine primero su propia devolución.
  useEffect(() => {
    if (dialog !== null) return;
    const originCredentialId = menuOriginRef.current;
    if (originCredentialId === null) return;
    menuOriginRef.current = null;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      const focusIsLost = active === null || active === document.body || !active.isConnected;
      if (!focusIsLost) return;
      const trigger = tableRegionRef.current?.querySelector<HTMLElement>(
        rowMenuTriggerSelector(originCredentialId),
      );
      (trigger ?? tableRegionRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dialog]);

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

  // Sin poder leer el estado (USE y `credential.use_totp`) el diálogo no tiene punto de partida.
  const totpCapabilities = {
    canUse: canUseTotp(hasUseTotpPermission, myLevel),
    canEdit: canEditTotp(hasUpdatePermission, myLevel),
    canExport: canExportTotp(hasExportTotpPermission, myLevel),
  };

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: credentialsKeys.list(accountId) });
  };

  // Cambiar contraseña, historial y segundo factor se eligen en el menú de fila.
  function openFromMenu(kind: 'password' | 'history' | 'totp', credential: Credential) {
    menuOriginRef.current = credential.id;
    setDialog({ kind, credential });
  }

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
      <div
        ref={tableRegionRef}
        tabIndex={-1}
        className="focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
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
          canOpenTotp={totpCapabilities.canUse}
          onCopyUsername={(credential) => {
            void handleCopyUsername(credential);
          }}
          onReveal={(credential) => {
            setDialog({ kind: 'reveal', credential });
          }}
          onChangePassword={(credential) => {
            openFromMenu('password', credential);
          }}
          onViewHistory={(credential) => {
            openFromMenu('history', credential);
          }}
          onOpenTotp={(credential) => {
            openFromMenu('totp', credential);
          }}
        />
      </div>
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
      {dialog?.kind === 'totp' ? (
        <TotpDialog
          credential={dialog.credential}
          capabilities={totpCapabilities}
          onClose={close}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}
