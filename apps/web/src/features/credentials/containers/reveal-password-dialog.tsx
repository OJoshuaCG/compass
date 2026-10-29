import { ErrorCode, type Credential } from '@iam/contracts';
import { Alert, Button, CopyButton, Dialog, FormField, Input, PasswordInput } from '@iam/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revealCredentialPassword } from '../api/credentials-api';
import {
  CLIPBOARD_CLEAR_MS,
  CLIPBOARD_CLEAR_SECONDS,
  isRevealReasonValid,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
  REVEALED_PASSWORD_VISIBLE_MS,
  REVEALED_PASSWORD_VISIBLE_SECONDS,
  revealReasonLength,
} from '../model/secret-policy';

/**
 * Fases del diálogo. La contraseña vive SOLO en la fase `shown`, es decir, en el estado de este
 * componente: no pasa por Query, por la URL, por el almacenamiento ni por la consola.
 */
type Phase = { kind: 'ask' } | { kind: 'shown'; password: string } | { kind: 'hidden' };

type ReasonFormProps = {
  credential: Credential;
  /** Verdadero al volver desde «Revelar de nuevo»: el botón pulsado se desmontó y el foco se perdió. */
  focusReasonOnMount: boolean;
  onCancel: () => void;
  onRevealed: (password: string) => void;
};

function ReasonForm({ credential, focusReasonOnMount, onCancel, onRevealed }: ReasonFormProps) {
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const [reason, setReason] = useState('');
  // La validación empieza al enviar; después responde en vivo a cada cambio.
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((trimmedReason: string) =>
    revealCredentialPassword(credential.id, trimmedReason),
  );
  const cooldown = useRateLimitCooldown(action.error);
  const reasonRef = useRef<HTMLInputElement>(null);

  // El motivo no es un secreto: es un destino de foco seguro tras volver a la fase de petición.
  useEffect(() => {
    if (focusReasonOnMount) reasonRef.current?.focus();
  }, [focusReasonOnMount]);

  // Tras un error el botón de envío quedó deshabilitado o en carga y el foco pudo perderse. El
  // aviso de error ya se anuncia solo (role="alert"), así que aquí solo se devuelve el foco.
  useEffect(() => {
    if (action.error !== undefined) reasonRef.current?.focus();
  }, [action.error]);

  const apiError = action.error instanceof ApiError ? action.error : undefined;
  const limitReached = apiError?.code === ErrorCode.CREDENTIAL_REVEAL_LIMIT;
  const serverRejectedReason = apiError?.code === ErrorCode.CREDENTIAL_REASON_INVALID;
  const clientRejectedReason = submitted && !isRevealReasonValid(reason);
  const reasonError =
    clientRejectedReason || serverRejectedReason
      ? t('CREDENTIAL.REASON_INVALID', { ns: 'errors' })
      : undefined;

  async function submit() {
    setSubmitted(true);
    if (!isRevealReasonValid(reason)) return;
    const result = await action.run(reason.trim());
    if (result.ok) onRevealed(result.value);
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <Alert tone="warning">{t('reveal.warning', { ns: 'credentials' })}</Alert>
      {action.error !== undefined && !serverRejectedReason ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('reveal.reason', { ns: 'credentials' })}
        required
        help={t('reveal.counter', {
          ns: 'credentials',
          length: revealReasonLength(reason),
          max: REVEAL_REASON_MAX_LENGTH,
          min: REVEAL_REASON_MIN_LENGTH,
        })}
        error={reasonError}
      >
        {(field) => (
          <Input
            {...field}
            ref={reasonRef}
            value={reason}
            maxLength={REVEAL_REASON_MAX_LENGTH}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          loading={action.pending}
          disabled={cooldown.secondsLeft > 0 || limitReached}
        >
          {t('reveal.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}

type ShownPasswordProps = {
  password: string;
  onHide: () => void;
};

function ShownPassword({ password, onHide }: ShownPasswordProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // El foco va al aviso de ocultado automático y NO al campo de la contraseña: así un lector de
  // pantalla no lee el secreto sin que la persona lo pida (WCAG 2.4.3). El campo queda justo antes
  // en el orden de lectura.
  useEffect(() => {
    noticeRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <FormField label={t('reveal.password', { ns: 'credentials' })}>
        {(field) => (
          <PasswordInput
            {...field}
            readOnly
            value={password}
            autoComplete="off"
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
          />
        )}
      </FormField>
      <p ref={noticeRef} tabIndex={-1} className="text-sm text-text-secondary">
        {t('reveal.autoHide', { ns: 'credentials', seconds: REVEALED_PASSWORD_VISIBLE_SECONDS })}{' '}
        {t('reveal.clipboardNote', { ns: 'credentials', seconds: CLIPBOARD_CLEAR_SECONDS })}
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <CopyButton
          value={password}
          label={t('reveal.copy', { ns: 'credentials' })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
        />
        <Button onClick={onHide}>{t('reveal.hideNow', { ns: 'credentials' })}</Button>
      </div>
    </div>
  );
}

type RevealBodyProps = {
  credential: Credential;
  onClose: () => void;
};

function RevealBody({ credential, onClose }: RevealBodyProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  // Se vuelve verdadero la primera vez que la contraseña se oculta; el diálogo recién abierto no
  // debe robarle el foco inicial a Radix.
  const [hasBeenHidden, setHasBeenHidden] = useState(false);
  const hiddenNoticeRef = useRef<HTMLParagraphElement>(null);

  // Oculta a los 30 s. Al desmontar se cancela el temporizador y el estado se descarta con el
  // componente, así que cerrar el diálogo también borra la contraseña.
  useEffect(() => {
    if (phase.kind !== 'shown') return;
    const timer = window.setTimeout(() => {
      setHasBeenHidden(true);
      setPhase({ kind: 'hidden' });
    }, REVEALED_PASSWORD_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  const isHidden = phase.kind === 'hidden';
  useEffect(() => {
    if (isHidden) hiddenNoticeRef.current?.focus();
  }, [isHidden]);

  // Mensajes fijos de i18n: la región NUNCA recibe la contraseña ni nada derivado de ella.
  let announcement = '';
  if (phase.kind === 'shown') {
    announcement = t('reveal.status.shown', {
      ns: 'credentials',
      seconds: REVEALED_PASSWORD_VISIBLE_SECONDS,
    });
  } else if (phase.kind === 'hidden') {
    announcement = t('reveal.status.hidden', { ns: 'credentials' });
  }

  let body: ReactNode;
  if (phase.kind === 'shown') {
    body = (
      <ShownPassword
        password={phase.password}
        onHide={() => {
          setHasBeenHidden(true);
          setPhase({ kind: 'hidden' });
        }}
      />
    );
  } else if (phase.kind === 'hidden') {
    body = (
      <div className="flex flex-col gap-4">
        {/* Párrafo y no Alert: el Alert (role="alert") repetiría lo que ya anuncia la región de estado. */}
        <p
          ref={hiddenNoticeRef}
          tabIndex={-1}
          className="rounded-md border border-border-strong px-4 py-3 text-sm text-text"
        >
          {t('reveal.hidden', { ns: 'credentials' })}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.close', { ns: 'common' })}
          </Button>
          <Button
            onClick={() => {
              setPhase({ kind: 'ask' });
            }}
          >
            {t('reveal.again', { ns: 'credentials' })}
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <ReasonForm
        credential={credential}
        focusReasonOnMount={hasBeenHidden}
        onCancel={onClose}
        onRevealed={(password) => {
          setPhase({ kind: 'shown', password });
        }}
      />
    );
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {body}
    </>
  );
}

export type RevealPasswordDialogProps = {
  credential: Credential;
  onClose: () => void;
};

/**
 * Diálogo de revelación: motivo obligatorio (6 a 500 caracteres con contador en vivo), aviso de no
 * pegar secretos, y la contraseña visible 30 s en el estado local. La reautenticación la resuelve
 * el cliente HTTP (abre su diálogo y reintenta una vez); si se cancela, aquí se ve el mensaje.
 */
export function RevealPasswordDialog({ credential, onClose }: RevealPasswordDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('reveal.title', { ns: 'credentials', label: credential.label })}
      description={t('reveal.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <RevealBody credential={credential} onClose={onClose} />
    </Dialog>
  );
}
