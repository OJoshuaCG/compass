import type { Credential, CredentialTotp } from '@iam/contracts';
import { Alert, Button, Dialog, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { fetchTotpStatus, totpKeys } from '../api/totp-api';
import { availableActionsFor, viewStatusOf, type TotpCapabilities } from '../model/totp-model';
import { TotpStatusSummary } from '../ui/totp-status-summary';

import { TotpCodePanel } from './totp-code-panel';
import { TotpConfirmForm } from './totp-confirm-form';
import { TotpExportPanel } from './totp-export-panel';
import { TotpRegisterForm } from './totp-register-form';
import { TotpRetireDialog } from './totp-retire-dialog';
import { TotpUnlockDialog } from './totp-unlock-dialog';

type TotpBodyProps = {
  credential: Credential;
  /** `null` cuando la credencial no tiene segundo factor. */
  totp: CredentialTotp | null;
  capabilities: TotpCapabilities;
  timeZone: string | undefined;
  /** Algo cambió en el servidor: recargar el estado (y el listado de credenciales). */
  onChanged: () => void;
};

function TotpBody({ credential, totp, capabilities, timeZone, onChanged }: TotpBodyProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const [reRegistering, setReRegistering] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const status = viewStatusOf(totp);
  const actions = availableActionsFor(status, capabilities);
  // El servidor solo informa el fin del bloqueo mientras sigue vigente.
  const isConfirmLocked = typeof totp?.confirmLockedUntil === 'string';
  const hasLiveFactor = status === 'pending' || status === 'verified';
  // Sin factor vigente la única salida es registrar; con uno vigente el re-registro es opcional.
  const showRegisterForm = actions.register && (!hasLiveFactor || reRegistering);

  return (
    <div className="flex flex-col gap-6">
      <TotpStatusSummary totp={totp} timeZone={timeZone} />
      {totp?.exposed === true ? (
        <Alert tone="warning">{t('totp.exposedNote', { ns: 'credentials' })}</Alert>
      ) : null}
      {status === 'none' && !actions.register ? (
        <Alert tone="info">{t('totp.noneReadOnly', { ns: 'credentials' })}</Alert>
      ) : null}
      {totp !== null && actions.confirm ? (
        <TotpConfirmForm credential={credential} digits={totp.digits} onConfirmed={onChanged} />
      ) : null}
      {actions.unlockConfirmation && isConfirmLocked ? (
        <div className="flex flex-col gap-3">
          <Alert tone="warning">{t('totp.unlock.lockedNote', { ns: 'credentials' })}</Alert>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setUnlocking(true);
              }}
            >
              {t('totp.unlock.open', { ns: 'credentials' })}
            </Button>
          </div>
        </div>
      ) : null}
      {status === 'pending' && !actions.confirm ? (
        <Alert tone="warning">{t('totp.confirm.pendingReadOnly', { ns: 'credentials' })}</Alert>
      ) : null}
      {totp !== null && actions.getCode ? (
        <TotpCodePanel
          credential={credential}
          digits={totp.digits}
          periodSeconds={totp.periodSeconds}
        />
      ) : null}
      {actions.exportKey ? (
        <TotpExportPanel credential={credential} onExported={onChanged} />
      ) : null}
      {showRegisterForm ? (
        <TotpRegisterForm
          credential={credential}
          isReRegistration={totp !== null}
          onCancel={
            hasLiveFactor
              ? () => {
                  setReRegistering(false);
                }
              : undefined
          }
          onRegistered={() => {
            setReRegistering(false);
            onChanged();
          }}
        />
      ) : null}
      {hasLiveFactor && actions.register && !reRegistering ? (
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setReRegistering(true);
            }}
          >
            {t('totp.register.again', { ns: 'credentials' })}
          </Button>
          {actions.retire ? (
            <Button
              variant="danger"
              onClick={() => {
                setRetiring(true);
              }}
            >
              {t('totp.retire.open', { ns: 'credentials' })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {unlocking ? (
        <TotpUnlockDialog
          credential={credential}
          onClose={() => {
            setUnlocking(false);
          }}
          onDone={() => {
            setUnlocking(false);
            onChanged();
          }}
        />
      ) : null}
      {retiring ? (
        <TotpRetireDialog
          credential={credential}
          onClose={() => {
            setRetiring(false);
          }}
          onDone={() => {
            setRetiring(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

export type TotpDialogProps = {
  credential: Credential;
  /** Decisiones de comodidad (permiso + nivel) que toma el container; el servidor decide siempre. */
  capabilities: TotpCapabilities;
  onClose: () => void;
  /** Cambió el segundo factor: la página recarga el listado (registrar puede cambiar el tipo). */
  onChanged: () => void;
};

/**
 * Diálogo del segundo factor de una credencial: estado, registro por clave manual, confirmación,
 * código bajo demanda, exportación con motivo y retiro con confirmación. El estado son metadatos y
 * es lo único que pasa por Query; códigos, enlaces y claves viven en el estado local de cada panel
 * y se descartan al cerrar.
 */
export function TotpDialog({ credential, capabilities, onClose, onChanged }: TotpDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const queryClient = useQueryClient();
  const timeZone = useMe()?.user.timezone;

  // Puede cambiar desde otra pestaña o persona: siempre se recarga al abrir. Si una recarga falla
  // con datos ya en pantalla, se conservan: quitarlos desmontaría el código o la clave visibles.
  const statusQuery = useQuery({
    queryKey: totpKeys.status(credential.id),
    queryFn: ({ signal }) => fetchTotpStatus(credential.id, signal),
    staleTime: 0,
  });

  function handleChanged() {
    void queryClient.invalidateQueries({ queryKey: totpKeys.status(credential.id) });
    onChanged();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('totp.title', { ns: 'credentials', label: credential.label })}
      description={t('totp.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {statusQuery.isPending ? <Spinner label={t('state.loading', { ns: 'common' })} /> : null}
      {statusQuery.isError && statusQuery.data === undefined ? (
        <ErrorAlert
          error={statusQuery.error}
          onRetry={() => {
            void statusQuery.refetch();
          }}
        />
      ) : null}
      {statusQuery.data !== undefined ? (
        <TotpBody
          credential={credential}
          totp={statusQuery.data}
          capabilities={capabilities}
          timeZone={timeZone}
          onChanged={handleChanged}
        />
      ) : null}
    </Dialog>
  );
}
