import { ErrorCode, type InboundReset } from '@iam/contracts';
import { Alert, Button, Card, CopyButton, FormField, Input, PasswordInput } from '@iam/ui';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';
import { revealInboundResets } from '../api/inbound-api';
import {
  INBOUND_CLIPBOARD_CLEAR_MS,
  INBOUND_CLIPBOARD_CLEAR_SECONDS,
} from '../model/inbound-code-model';
import {
  isRevealReasonValid,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
  REVEALED_RESET_VISIBLE_MS,
  REVEALED_RESET_VISIBLE_SECONDS,
  revealReasonLength,
} from '../model/inbound-reset-policy';

/**
 * Fases del panel. Los restablecimientos viven SOLO en la fase `shown`, es decir, en el estado de
 * este componente: no pasan por Query, la URL, el almacenamiento ni la consola.
 */
type Phase =
  | { kind: 'closed' }
  | { kind: 'ask' }
  | { kind: 'shown'; resets: readonly InboundReset[] }
  | { kind: 'hidden' };

type ReasonFormProps = {
  viewId: string;
  onCancel: () => void;
  onRevealed: (resets: readonly InboundReset[]) => void;
};

function RevealReasonForm({ viewId, onCancel, onRevealed }: ReasonFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const [reason, setReason] = useState('');
  // La validación empieza al enviar; después responde en vivo a cada cambio.
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((trimmedReason: string) =>
    revealInboundResets(viewId, trimmedReason),
  );
  const cooldown = useRateLimitCooldown(action.error);
  const reasonRef = useRef<HTMLInputElement>(null);
  const resetAction = action.reset;

  // Al desmontar (Cancelar, cambiar de vista o de pantalla) se invalida la ejecución en curso: si la
  // respuesta llega después, `run` la descarta y los valores no aparecen tras haber cancelado. El
  // servidor sí la habrá auditado; eso es correcto, porque la revelación ocurrió.
  useEffect(() => resetAction, [resetAction]);

  // Tras un error el foco vuelve al motivo, que no es un secreto; el aviso se anuncia solo (role="alert").
  useEffect(() => {
    if (action.error !== undefined) reasonRef.current?.focus();
  }, [action.error]);

  const apiError = action.error instanceof ApiError ? action.error : undefined;
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
    if (result.ok) onRevealed(result.value.data);
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
      <Alert tone="warning">{t('resets.warning', { ns: 'inbound' })}</Alert>
      {action.error !== undefined && !serverRejectedReason ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('resets.reason', { ns: 'inbound' })}
        required
        help={t('resets.counter', {
          ns: 'inbound',
          length: revealReasonLength(reason),
          max: REVEAL_REASON_MAX_LENGTH,
          min: REVEAL_REASON_MIN_LENGTH,
        })}
        error={reasonError}
      >
        {(controlProps) => (
          <Input
            {...controlProps}
            ref={reasonRef}
            value={reason}
            maxLength={REVEAL_REASON_MAX_LENGTH}
            autoComplete="off"
            invalid={controlProps['aria-invalid'] === true}
            onChange={(event) => {
              setReason(event.target.value);
              // El rechazo del servidor se refería al motivo anterior; al corregirlo deja de aplicar.
              // Solo ese error se limpia: uno de límite de intentos debe seguir con su espera.
              if (serverRejectedReason) action.reset();
            }}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('resets.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

type ShownResetsProps = {
  resets: readonly InboundReset[];
  /** Aviso de la fase: destino del foco al mostrar los valores, lo asigna el panel. */
  noticeRef: RefObject<HTMLParagraphElement | null>;
  onHide: () => void;
  /** Sin nada vigente no hubo revelación: se vuelve al inicio, no al aviso de «se ocultaron». */
  onClose: () => void;
};

function ShownResets({ resets, noticeRef, onHide, onClose }: ShownResetsProps) {
  const { t, i18n } = useTranslation(['inbound', 'common']);
  const timeZone = useMe()?.user.timezone;
  const showLabel = t('password.show', { ns: 'common' });
  const hideLabel = t('password.hide', { ns: 'common' });
  const copiedLabel = t('clipboard.copied', { ns: 'common' });
  const failedLabel = t('clipboard.failed', { ns: 'common' });

  if (resets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {/* Párrafo y no Alert: el foco ya lo anuncia; un role="alert" lo repetiría. */}
        <p
          ref={noticeRef}
          tabIndex={-1}
          className="rounded-md border border-border-strong bg-raised px-4 py-3 text-sm text-text"
        >
          {t('resets.none', { ns: 'inbound' })}
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('resets.close', { ns: 'inbound' })}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p ref={noticeRef} tabIndex={-1} className="text-sm text-text-secondary">
        {t('resets.autoHide', { ns: 'inbound', seconds: REVEALED_RESET_VISIBLE_SECONDS })}{' '}
        {t('codes.clipboardNote', { ns: 'inbound', seconds: INBOUND_CLIPBOARD_CLEAR_SECONDS })}
      </p>
      <ul className="flex flex-col gap-4">
        {resets.map((reset, index) => {
          const position = index + 1;
          const kindLabel = t(`templateKind.${reset.kind}`, { ns: 'inbound' });
          return (
            <li key={reset.itemId}>
              <Card className="flex flex-col gap-2 bg-raised p-4">
                {/*
                 * El enlace va en un campo enmascarado igual que un código y nunca como <a>: un clic
                 * accidental lo consumiría en un navegador ajeno a la persona que restablece, y un ancla
                 * lo dejaría en el historial y en la cabecera Referer.
                 */}
                <FormField
                  label={t('resets.item', { ns: 'inbound', position, kind: kindLabel })}
                  help={t('resets.expiresAt', {
                    ns: 'inbound',
                    time: formatDateTime(reset.expiresAt, i18n.language, timeZone),
                  })}
                >
                  {(controlProps) => (
                    <PasswordInput
                      {...controlProps}
                      readOnly
                      value={reset.value}
                      autoComplete="off"
                      className="font-mono text-accent"
                      showLabel={showLabel}
                      hideLabel={hideLabel}
                    />
                  )}
                </FormField>
                <div className="flex justify-end">
                  <CopyButton
                    value={reset.value}
                    label={t('resets.copy', { ns: 'inbound', position })}
                    copiedLabel={copiedLabel}
                    failedLabel={failedLabel}
                    clearAfterMs={INBOUND_CLIPBOARD_CLEAR_MS}
                  />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button onClick={onHide}>{t('resets.hideNow', { ns: 'inbound' })}</Button>
      </div>
    </div>
  );
}

/** Controles que reciben foco y en los que la persona puede estar escribiendo o pulsando. */
const INTERACTIVE_CONTROL_SELECTOR =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

/**
 * Verdadero solo si el foco está en un control interactivo AJENO al panel. El ocultado automático
 * a los 30 s no debe robar el foco a quien está, por ejemplo, copiando un código del otro panel.
 */
function isFocusOnForeignControl(container: HTMLElement | null): boolean {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return false;
  if (container !== null && container.contains(focused)) return false;
  return focused.matches(INTERACTIVE_CONTROL_SELECTOR);
}

export type InboundResetRevealPanelProps = {
  viewId: string;
};

/**
 * Revelar los restablecimientos vigentes de la vista (permiso `inbound.reveal_reset` y MANAGE sobre la
 * vista, ADR 0045): motivo escrito de 6 a 500 caracteres y los valores visibles 30 s en el estado local.
 * Ocultar el panel a quien no cumple es solo comodidad: el servidor decide, audita cada revelación como
 * evento crítico y avisa a la Raíz. La reautenticación la resuelve el cliente HTTP.
 */
export function InboundResetRevealPanel({ viewId }: InboundResetRevealPanelProps) {
  const { t } = useTranslation('inbound');
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const phaseNoticeRef = useRef<HTMLParagraphElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const previousPhaseKind = useRef<Phase['kind']>('closed');

  // Tras cada cambio de fase el botón pulsado se desmontó: el foco va al aviso de la fase (que no
  // contiene ningún valor) o, si no hay aviso, al encabezado (WCAG 2.4.3).
  const phaseKind = phase.kind;
  useEffect(() => {
    if (previousPhaseKind.current === phaseKind) return;
    previousPhaseKind.current = phaseKind;
    if (isFocusOnForeignControl(sectionRef.current)) return;
    (phaseNoticeRef.current ?? headingRef.current)?.focus();
  }, [phaseKind]);

  // Oculta a los 30 s. Al desmontar (cambiar de vista o de pantalla) se cancela el temporizador y los
  // valores se descartan con el componente.
  useEffect(() => {
    if (phase.kind !== 'shown') return;
    const timer = window.setTimeout(() => {
      setPhase({ kind: 'hidden' });
    }, REVEALED_RESET_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  return (
    <Card ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg text-text">
        {t('resets.heading')}
      </h2>
      {phase.kind === 'closed' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">{t('resets.description')}</p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ kind: 'ask' });
              }}
            >
              {t('resets.open')}
            </Button>
          </div>
        </div>
      ) : null}
      {phase.kind === 'ask' ? (
        <RevealReasonForm
          viewId={viewId}
          onCancel={() => {
            setPhase({ kind: 'closed' });
          }}
          onRevealed={(resets) => {
            setPhase({ kind: 'shown', resets });
          }}
        />
      ) : null}
      {phase.kind === 'shown' ? (
        <ShownResets
          resets={phase.resets}
          noticeRef={phaseNoticeRef}
          onHide={() => {
            setPhase({ kind: 'hidden' });
          }}
          onClose={() => {
            setPhase({ kind: 'closed' });
          }}
        />
      ) : null}
      {phase.kind === 'hidden' ? (
        <div className="flex flex-col gap-3">
          <p
            ref={phaseNoticeRef}
            tabIndex={-1}
            className="rounded-md border border-border-strong bg-raised px-4 py-3 text-sm text-text"
          >
            {t('resets.hidden')}
          </p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ kind: 'ask' });
              }}
            >
              {t('resets.again')}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
