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
import { TOTP_COUNTDOWN_TICK_MS } from '../model/totp-model';

/**
 * Fases del diálogo. La contraseña vive SOLO en la fase `shown`, es decir, en el estado de este
 * componente: no pasa por Query, por la URL, por el almacenamiento ni por la consola.
 */
type Phase =
  { kind: 'ask' } | { kind: 'shown'; password: string; secondsLeft: number } | { kind: 'hidden' };

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
  secondsLeft: number;
  onHide: () => void;
};

function ShownPassword({ password, secondsLeft, onHide }: ShownPasswordProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // El foco va al aviso de ocultado automático y NO al campo de la contraseña: así un lector de
  // pantalla no lee el secreto sin que la persona lo pida (WCAG 2.4.3). El campo queda justo antes
  // en el orden de lectura. Este foco es el ÚNICO anuncio del cambio de fase: no hay región de
  // estado aparte que repita el mismo mensaje.
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
      {/* Cuenta regresiva visible y silenciosa: aria-live="off" evita que se anuncie cada segundo.
          Solo lleva texto fijo y segundos, nunca el valor del secreto. */}
      <p role="timer" aria-live="off" className="text-sm text-text-secondary tabular-nums">
        {t('reveal.countdown', { ns: 'credentials', seconds: secondsLeft })}
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

/** Controles que reciben foco y en los que la persona puede estar escribiendo o pulsando. */
const INTERACTIVE_CONTROL_SELECTOR =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

/**
 * Verdadero solo si el foco está en un control interactivo AJENO al contenedor (p. ej. el motivo
 * del otro panel del mismo diálogo). Un cambio de fase automático (temporizador) no debe robarlo:
 * la persona estaría escribiendo y el foco saltaría al aviso.
 *
 * Es el inverso explícito de «foco propio o perdido» porque, al desmontarse el botón enfocado,
 * el FocusScope de Radix devuelve el foco al contenedor del diálogo (role="dialog", tabIndex -1),
 * que no es <body> ni está dentro del panel, pero tampoco es un control de la persona. Cualquier
 * otro caso (null, <body>, dentro del contenedor o un contenedor no interactivo) sí mueve el foco.
 */
function isFocusOnForeignControl(container: HTMLElement | null): boolean {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return false;
  if (container !== null && container.contains(focused)) return false;
  return focused.matches(INTERACTIVE_CONTROL_SELECTOR);
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
  const bodyRef = useRef<HTMLDivElement>(null);

  // Oculta a los 30 s. Al desmontar se cancelan los temporizadores y el estado se descarta con el
  // componente, así que cerrar el diálogo también borra la contraseña. El efecto depende solo de
  // `isShown`: si dependiera de `phase`, cada tick de la cuenta regresiva reiniciaría el ocultado.
  const isShown = phase.kind === 'shown';
  useEffect(() => {
    if (!isShown) return;
    // Un único instante límite: el ocultado y la cuenta regresiva salen del mismo origen, así lo
    // que se ve nunca se desfasa del ocultado real. El intervalo solo vuelve a pintar; quien oculta
    // sigue siendo el temporizador de 30 s.
    const deadlineMs = Date.now() + REVEALED_PASSWORD_VISIBLE_MS;
    const hideTimer = window.setTimeout(() => {
      setHasBeenHidden(true);
      setPhase({ kind: 'hidden' });
    }, REVEALED_PASSWORD_VISIBLE_MS);
    const countdownTimer = window.setInterval(() => {
      const secondsLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
      setPhase((current) => {
        if (current.kind !== 'shown' || current.secondsLeft === secondsLeft) return current;
        return { ...current, secondsLeft };
      });
    }, TOTP_COUNTDOWN_TICK_MS);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearInterval(countdownTimer);
    };
  }, [isShown]);

  // Tanto al ocultar a mano como al expirar solo, el botón o el campo que tenían el foco se
  // desmontan. El aviso de oculto sigue montado en esa fase: es el destino estable del foco y su
  // texto fijo (sin el valor) es el anuncio, por lo que no hay región de estado aparte.
  const isHidden = phase.kind === 'hidden';
  useEffect(() => {
    if (!isHidden) return;
    // Si se ocultó solo a los 30 s y el foco está en un control ajeno al cuerpo (p. ej. el botón de
    // cerrar del diálogo), no se mueve (ver isFocusOnForeignControl).
    if (isFocusOnForeignControl(bodyRef.current)) return;
    hiddenNoticeRef.current?.focus();
  }, [isHidden]);

  let body: ReactNode;
  if (phase.kind === 'shown') {
    body = (
      <ShownPassword
        password={phase.password}
        secondsLeft={phase.secondsLeft}
        onHide={() => {
          setHasBeenHidden(true);
          setPhase({ kind: 'hidden' });
        }}
      />
    );
  } else if (phase.kind === 'hidden') {
    body = (
      <div className="flex flex-col gap-4">
        {/* Párrafo y no Alert: el foco ya lo anuncia; un role="alert" lo repetiría. */}
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
          setPhase({
            kind: 'shown',
            password,
            secondsLeft: REVEALED_PASSWORD_VISIBLE_SECONDS,
          });
        }}
      />
    );
  }

  return <div ref={bodyRef}>{body}</div>;
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
