import type { Credential } from '@iam/contracts';
import {
  Badge,
  Button,
  buttonVariants,
  PlatformTile,
  Plus,
  Spinner,
  StatusBadge,
  Users,
} from '@iam/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { ErrorAlert, useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import {
  ArchiveAccountDialog,
  canArchiveAccount,
  canEditAccount,
  EditAccountDialog,
} from '../../accounts';
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
import { AccountInfoPanel } from '../ui/account-info-panel';
import { AccountOptionsPanel } from '../ui/account-options-panel';
import { AccountSharesPanel } from '../ui/account-shares-panel';
import { CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_SECONDS } from '../model/secret-policy';
import { CredentialCards, rowMenuTriggerSelector } from '../ui/credential-cards';

import { ChangePasswordDialog } from './change-password-dialog';
import { CreateCredentialDialog } from './create-credential-dialog';
import { HistoryDialog } from './history-dialog';
import { RevealPasswordDialog, type RevealPasswordDialogHandle } from './reveal-password-dialog';
import { copySecretWithAutoClear } from './secret-clipboard';
import { TotpDialog } from './totp-dialog';

type DialogState =
  { kind: 'create' } | { kind: 'password' | 'history' | 'totp'; credential: Credential } | null;

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
  const credentialsCatalogReady = useLazyCatalog('credentials');
  // Los diálogos de editar y archivar la cuenta son del feature `accounts` y usan sus textos.
  const accountsCatalogReady = useLazyCatalog('accounts');
  const catalogReady = credentialsCatalogReady && accountsCatalogReady;
  const navigate = useNavigate();
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
  const hasAccountUpdatePermission = usePermission('account.update');
  const hasAccountArchivePermission = usePermission('account.archive');
  const [accountDialog, setAccountDialog] = useState<'edit' | 'archive' | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  // Fila cuyo menú "⋯" abrió el diálogo actual; sirve para devolver el foco al cerrarlo.
  const menuOriginRef = useRef<string | null>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  // El diálogo de revelar vive montado para que la petición salga del clic de la fila (ver su doc).
  const revealDialogRef = useRef<RevealPasswordDialogHandle>(null);

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
        <PlatformTile
          size="lg"
          slug={platform?.isGlobal === true ? platform.slug : undefined}
          fallback={platform?.name ?? account.displayName}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-2xl text-text">{account.displayName}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            {subtitle !== '' ? <span>{subtitle}</span> : null}
            {account.status === 'active' ? (
              <StatusBadge status="success" label={t('status.active', { ns: 'credentials' })} />
            ) : (
              <StatusBadge status="neutral" label={t('status.archived', { ns: 'credentials' })} />
            )}
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
                <Plus aria-hidden="true" className="size-4" />
                {t('action.create', { ns: 'credentials' })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {copyUsername.error !== undefined ? <ErrorAlert error={copyUsername.error} /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="credentials-section"
          className="flex flex-col gap-3 lg:col-span-2"
        >
          <h2 id="credentials-section" className="flex items-baseline gap-2 text-lg text-text">
            {t('section.title', { ns: 'credentials' })}
            {credentialsQuery.data !== undefined ? (
              <span className="text-sm font-normal text-text-muted">
                {t('section.count', { ns: 'credentials', count: credentialsQuery.data.length })}
              </span>
            ) : null}
          </h2>
          <div
            ref={tableRegionRef}
            tabIndex={-1}
            className="focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
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
                revealDialogRef.current?.reveal(credential);
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
        </section>
        <div className="flex flex-col gap-6">
          <AccountInfoPanel
            account={account}
            platformName={platform?.name}
            credentials={credentialsQuery.data}
            timeZone={timeZone}
          />
          {canManageShares ? (
            <AccountSharesPanel
              accountId={accountId}
              shares={sharesQuery.data}
              status={sharesQuery.isPending ? 'loading' : sharesQuery.isError ? 'error' : 'success'}
              errorMessage={errorMessage(sharesQuery.error)}
              timeZone={timeZone}
            />
          ) : null}
          <AccountOptionsPanel
            accountId={accountId}
            canManageShares={canManageShares}
            canEdit={canEditAccount(hasAccountUpdatePermission, myLevel)}
            canArchive={canArchiveAccount(hasAccountArchivePermission, myLevel)}
            onEdit={() => {
              setAccountDialog('edit');
            }}
            onArchive={() => {
              setAccountDialog('archive');
            }}
          />
        </div>
      </div>
      {accountDialog === 'edit' ? (
        <EditAccountDialog
          account={account}
          onClose={() => {
            setAccountDialog(null);
          }}
          onUpdated={(displayName) => {
            setAccountDialog(null);
            toast.show(t('edit.toast', { ns: 'accounts', name: displayName }), 'success');
            void queryClient.invalidateQueries({ queryKey: credentialsKeys.account(accountId) });
          }}
          onReload={() => {
            setAccountDialog(null);
            void queryClient.invalidateQueries({ queryKey: credentialsKeys.account(accountId) });
          }}
        />
      ) : null}
      {accountDialog === 'archive' ? (
        <ArchiveAccountDialog
          account={account}
          onClose={() => {
            setAccountDialog(null);
          }}
          onDone={() => {
            setAccountDialog(null);
            toast.show(
              t('archive.toast', { ns: 'accounts', name: account.displayName }),
              'success',
            );
            // La cuenta archivada deja de estar disponible: se vuelve al listado.
            void navigate({ to: '/accounts' });
          }}
        />
      ) : null}
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
      <RevealPasswordDialog ref={revealDialogRef} />
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
