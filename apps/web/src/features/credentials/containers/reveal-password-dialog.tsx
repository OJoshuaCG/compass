import { ErrorCode, type Credential } from '@iam/contracts';
import { Button, CopyButton, Dialog, FormField, PasswordInput, Spinner } from '@iam/ui';
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revealCredentialPassword } from '../api/credentials-api';
import {
  CLIPBOARD_CLEAR_MS,
  CLIPBOARD_CLEAR_SECONDS,
  REVEALED_PASSWORD_VISIBLE_MS,
  REVEALED_PASSWORD_VISIBLE_SECONDS,
} from '../model/secret-policy';
import { TOTP_COUNTDOWN_TICK_MS } from '../model/totp-model';

/**
 * Fases del diálogo. La contraseña vive SOLO en la fase `shown`, es decir, en el estado de este
 * componente: no pasa por Query, por la URL, por el almacenamiento ni por la consola.
 */
type Phase =
  | { kind: 'closed' }
  | { kind: 'loading'; credential: Credential }
  | { kind: 'error'; credential: Credential; error: unknown }
  | { kind: 'shown'; credential: Credential; password: string; secondsLeft: number }
  | { kind: 'hidden'; credential: Credential };

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

/** Oculta solo si sigue visible; un cierre previo no debe resucitar el diálogo. */
function hiddenFrom(current: Phase): Phase {
  return current.kind === 'shown' ? { kind: 'hidden', credential: current.credential } : current;
}

type RevealErrorPanelProps = {
  error: unknown;
  onClose: () => void;
  onRetry: () => void;
};

function RevealErrorPanel({ error, onClose, onRetry }: RevealErrorPanelProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const cooldown = useRateLimitCooldown(error);
  const limitReached =
    error instanceof ApiError && error.code === ErrorCode.CREDENTIAL_REVEAL_LIMIT;
  return (
    <div className="flex flex-col gap-4">
      <ErrorAlert error={error} secondsLeft={cooldown.secondsLeft} />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.close', { ns: 'common' })}
        </Button>
        <Button onClick={onRetry} disabled={cooldown.secondsLeft > 0 || limitReached}>
          {t('actions.retry', { ns: 'common' })}
        </Button>
      </div>
    </div>
  );
}

type HiddenNoticeProps = {
  onClose: () => void;
  onRevealAgain: () => void;
};

function HiddenNotice({ onClose, onRevealAgain }: HiddenNoticeProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // Tanto al ocultar a mano como al expirar solo, el botón o el campo que tenían el foco se
  // desmontan. Este aviso es el destino estable del foco y su texto fijo (sin el valor) es el
  // anuncio, por lo que no hay región de estado aparte.
  useEffect(() => {
    // Si se ocultó solo a los 30 s y el foco está en un control ajeno al cuerpo (p. ej. el botón de
    // cerrar del diálogo), no se mueve (ver isFocusOnForeignControl).
    if (isFocusOnForeignControl(noticeRef.current?.parentElement ?? null)) return;
    noticeRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Párrafo y no Alert: el foco ya lo anuncia; un role="alert" lo repetiría. */}
      <p
        ref={noticeRef}
        tabIndex={-1}
        className="rounded-md border border-border-strong px-4 py-3 text-sm text-text"
      >
        {t('reveal.hidden', { ns: 'credentials' })}
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('actions.close', { ns: 'common' })}
        </Button>
        <Button onClick={onRevealAgain}>{t('reveal.again', { ns: 'credentials' })}</Button>
      </div>
    </div>
  );
}

/** Acciones que la pantalla puede pedirle al diálogo; la petición sale del clic que la invoca. */
export type RevealPasswordDialogHandle = {
  reveal: (credential: Credential) => void;
};

export type RevealPasswordDialogProps = {
  ref?: Ref<RevealPasswordDialogHandle>;
};

/**
 * Diálogo de revelación en un solo clic: sin motivo, la petición sale desde el manejador del clic
 * (`reveal`, o «Revelar de nuevo» y «Reintentar») y nunca desde un efecto de montaje, porque
 * StrictMode ejecuta los efectos dos veces y se revelaría y auditaría dos veces (cuenta para el
 * tope por hora). Por eso la pantalla lo mantiene montado y lo abre con `ref.reveal`.
 *
 * La contraseña vive 30 s en el estado local. Cerrar (botón, Escape, X) o desmontar invalida el
 * identificador de la petición: una respuesta que llegue después se ignora y no se guarda. La
 * reautenticación la resuelve el cliente HTTP (abre su diálogo y reintenta una vez).
 */
export function RevealPasswordDialog({ ref }: RevealPasswordDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  // Identificador de la petición vigente: cerrar lo avanza para que una respuesta tardía no cuente.
  const requestIdRef = useRef(0);
  // Cerrojo síncrono: dos clics en el mismo tick verían la misma fase y enviarían dos peticiones.
  const inFlightRef = useRef(false);

  function startReveal(credential: Credential) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setPhase({ kind: 'loading', credential });
    revealCredentialPassword(credential.id).then(
      (password) => {
        if (requestIdRef.current !== requestId) return;
        inFlightRef.current = false;
        setPhase({
          kind: 'shown',
          credential,
          password,
          secondsLeft: REVEALED_PASSWORD_VISIBLE_SECONDS,
        });
      },
      (error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        inFlightRef.current = false;
        setPhase({ kind: 'error', credential, error });
      },
    );
  }

  function hide() {
    setPhase(hiddenFrom);
  }

  function close() {
    requestIdRef.current += 1;
    inFlightRef.current = false;
    setPhase({ kind: 'closed' });
  }

  useImperativeHandle(ref, () => ({ reveal: startReveal }));

  // Al desmontar la pantalla, una respuesta en vuelo ya no debe escribir estado.
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  // Oculta a los 30 s. Al desmontar se cancelan los temporizadores y el estado se descarta con el
  // componente. El efecto depende solo de `isShown`: si dependiera de `phase`, cada tick de la
  // cuenta regresiva reiniciaría el ocultado.
  const isShown = phase.kind === 'shown';
  useEffect(() => {
    if (!isShown) return;
    // Un único instante límite: el ocultado y la cuenta regresiva salen del mismo origen, así lo
    // que se ve nunca se desfasa del ocultado real. El intervalo solo vuelve a pintar; quien oculta
    // sigue siendo el temporizador de 30 s.
    const deadlineMs = Date.now() + REVEALED_PASSWORD_VISIBLE_MS;
    const hideTimer = window.setTimeout(() => {
      setPhase(hiddenFrom);
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

  if (phase.kind === 'closed') return null;
  const credential = phase.credential;

  let body: ReactNode;
  if (phase.kind === 'shown') {
    body = (
      <ShownPassword password={phase.password} secondsLeft={phase.secondsLeft} onHide={hide} />
    );
  } else if (phase.kind === 'hidden') {
    body = (
      <HiddenNotice
        onClose={close}
        onRevealAgain={() => {
          startReveal(credential);
        }}
      />
    );
  } else if (phase.kind === 'error') {
    body = (
      <RevealErrorPanel
        error={phase.error}
        onClose={close}
        onRetry={() => {
          startReveal(credential);
        }}
      />
    );
  } else {
    // Spinner con etiqueta: su role="status" anuncia la carga una vez; al llegar la contraseña el
    // foco pasa al aviso de ocultado automático.
    body = (
      <div className="flex items-center gap-3 text-sm text-text-secondary">
        <Spinner label={t('reveal.loading', { ns: 'credentials' })} />
        <span aria-hidden="true">{t('reveal.loading', { ns: 'credentials' })}</span>
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t('reveal.title', { ns: 'credentials', label: credential.label })}
      description={t('reveal.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {body}
    </Dialog>
  );
}
