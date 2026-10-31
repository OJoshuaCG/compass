import type { Credential } from '@iam/contracts';
import { Badge, Button, buttonVariants, Spinner, Users } from '@iam/ui';
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
  fetchAccountShares,
  fetchCredentials,
  fetchCredentialUsername,
  fetchPlatforms,
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
import { AccountSharesPanel } from '../ui/account-shares-panel';
import { CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_SECONDS } from '../model/secret-policy';
import { CredentialCards, rowMenuTriggerSelector } from '../ui/credential-cards';

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
 * Container de `/accounts/:accountId/credentials`: el detalle de una cuenta como en el diseño de
 * Compass (encabezado, una tarjeta por credencial y, para quien las gestiona, con quién se comparte). Las acciones se ofrecen según el permiso y el `myLevel` de la cuenta
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
  const hasShareManagePermission = usePermission('share.manage');
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
  const platformsQuery = useQuery({
    queryKey: credentialsKeys.platforms(),
    queryFn: ({ signal }) => fetchPlatforms(signal),
  });
  // Solo quien puede gestionarlas ve con quién se comparte (el servidor exige `share.manage` y MANAGE).
  const canManageShares = hasShareManagePermission && accountQuery.data?.myLevel === 'MANAGE';
  const sharesQuery = useQuery({
    queryKey: credentialsKeys.shares(accountId),
    queryFn: ({ signal }) => fetchAccountShares(accountId, signal),
    enabled: canManageShares,
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

  // Cambiar contraseña e historial se eligen en el menú "⋯" de la tarjeta.
  function openFromMenu(kind: 'password' | 'history', credential: Credential) {
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

  const platform = platformsQuery.data?.find((item) => item.id === account.platformId);
  const monogram = (platform?.name ?? account.displayName).slice(0, 2).toUpperCase();
  const subtitle = [platform?.name, account.handle].filter(Boolean).join(' · ');

  const tableStatus = credentialsQuery.isPending
    ? 'loading'
    : credentialsQuery.isError
      ? 'error'
      : 'success';

  return (
    <>
      {backLink}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-raised text-lg font-bold text-accent"
        >
          {monogram}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-2xl text-text">{account.displayName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            {subtitle !== '' ? <span>{subtitle}</span> : null}
            {myLevel !== null ? (
              <Badge tone="accent">
                {t('account.level', {
                  ns: 'credentials',
                  level: t(`level.${myLevel}`, { ns: 'credentials' }),
                })}
              </Badge>
            ) : null}
            {account.tags.map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>
        </div>
        {allowCreate || canManageShares ? (
          <div className="flex flex-wrap items-center gap-2">
            {canManageShares ? (
              <Link
                to="/accounts/$accountId/shares"
                params={{ accountId }}
                className={buttonVariants({ variant: 'secondary' })}
              >
                <Users aria-hidden="true" className="size-4" />
                {t('action.share', { ns: 'credentials' })}
              </Link>
            ) : null}
            {allowCreate ? (
              <Button
                onClick={() => {
                  setDialog({ kind: 'create' });
                }}
              >
                {t('action.create', { ns: 'credentials' })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {copyUsername.error !== undefined ? <ErrorAlert error={copyUsername.error} /> : null}
      <div className={canManageShares ? 'grid items-start gap-6 lg:grid-cols-3' : undefined}>
        <div
          ref={tableRegionRef}
          tabIndex={-1}
          className="focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus lg:col-span-2"
        >
          <CredentialCards
            credentials={credentialsQuery.data ?? []}
            status={tableStatus}
            errorMessage={errorMessage(credentialsQuery.error)}
            onRetry={() => {
              void credentialsQuery.refetch();
            }}
            timeZone={timeZone}
            myLevel={myLevel}
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
              setDialog({ kind: 'totp', credential });
            }}
          />
        </div>
        {canManageShares ? (
          <AccountSharesPanel
            accountId={accountId}
            shares={sharesQuery.data}
            status={sharesQuery.isPending ? 'loading' : sharesQuery.isError ? 'error' : 'success'}
            errorMessage={errorMessage(sharesQuery.error)}
            timeZone={timeZone}
          />
        ) : null}
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
