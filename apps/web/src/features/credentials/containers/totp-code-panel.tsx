import type { Credential } from '@iam/contracts';
import { Button, CodeInput, CopyButton, FormField } from '@iam/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { issueTotpCode } from '../api/totp-api';
import { CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_SECONDS } from '../model/secret-policy';
import {
  advanceIssuedCode,
  issuedCodeFrom,
  secondsLeftOf,
  TOTP_COUNTDOWN_TICK_MS,
  type IssuedCode,
} from '../model/totp-model';

/**
 * Fases del panel. El código vive SOLO en la fase `shown`, es decir, en el estado de este
 * componente: no pasa por Query, la URL, el almacenamiento ni la consola.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'shown'; issued: IssuedCode; secondsLeft: number }
  | { kind: 'expired' }
  // Ocultado por la persona con «Ocultar ahora». Se pinta igual que `idle`; existe aparte para
  // poder anunciarlo sin anunciar nada al abrir el panel.
  | { kind: 'hidden' };

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

export type TotpCodePanelProps = {
  credential: Credential;
  /** Dígitos y periodo registrados: el periodo da la vigencia del código siguiente al promoverlo. */
  digits: number;
  periodSeconds: number;
};

/**
 * Pide el código vigente (nivel USE) y lo muestra con una cuenta regresiva. Al vencer lo descarta
 * solo; si el servidor entregó también el siguiente (faltaban menos de 5 s), ese toma su lugar.
 */
export function TotpCodePanel({ credential, digits, periodSeconds }: TotpCodePanelProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const action = useAsyncAction(() => issueTotpCode(credential.id));
  const cooldown = useRateLimitCooldown(action.error);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const phaseNoticeRef = useRef<HTMLParagraphElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const previousPhaseKind = useRef<Phase['kind']>('idle');

  // Tras cada cambio de fase el botón pulsado se desmontó. El foco va al aviso propio de la fase
  // (cuenta regresiva, «oculto» o «venció»), que sigue montado, es estable y no contiene el código
  // (WCAG 2.4.3). Ese foco es el ÚNICO anuncio del cambio: no hay región de estado aparte que lo
  // repita. Sin aviso en la fase (apertura del panel) se cae al encabezado, nunca al <body>.
  const phaseKind = phase.kind;
  useEffect(() => {
    if (previousPhaseKind.current === phaseKind) return;
    previousPhaseKind.current = phaseKind;
    // Si venció solo y la persona está en otro control, no se mueve el foco (ver isFocusOnForeignControl).
    if (isFocusOnForeignControl(sectionRef.current)) return;
    (phaseNoticeRef.current ?? headingRef.current)?.focus();
  }, [phaseKind]);

  // Un error deja el botón en carga o deshabilitado: el foco vuelve al encabezado, que siempre está
  // montado. El aviso del error ya se anuncia con role="alert", con mensaje fijo sin el código.
  useEffect(() => {
    if (action.error !== undefined) headingRef.current?.focus();
  }, [action.error]);

  const isShown = phase.kind === 'shown';
  useEffect(() => {
    if (!isShown) return;
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      setPhase((current) => {
        if (current.kind !== 'shown') return current;
        const advanced = advanceIssuedCode(current.issued, nowMs, periodSeconds);
        if (advanced === null) return { kind: 'expired' };
        const secondsLeft = secondsLeftOf(advanced, nowMs);
        // Misma referencia mientras nada cambia: React no vuelve a pintar entre un segundo y otro.
        if (advanced === current.issued && secondsLeft === current.secondsLeft) return current;
        return { kind: 'shown', issued: advanced, secondsLeft };
      });
    }, TOTP_COUNTDOWN_TICK_MS);
    // Al desmontar se cancela el temporizador y el código se descarta con el estado.
    return () => {
      window.clearInterval(timer);
    };
  }, [isShown, periodSeconds]);

  async function getCode() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (!result.ok) return;
    const nowMs = Date.now();
    const issued = issuedCodeFrom(result.value, nowMs);
    setPhase({ kind: 'shown', issued, secondsLeft: secondsLeftOf(issued, nowMs) });
  }

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base text-text">
        {t('totp.code.heading', { ns: 'credentials' })}
      </h3>
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      {phase.kind === 'shown' ? (
        <>
          <FormField label={t('totp.code.current', { ns: 'credentials' })}>
            {(controlProps) => (
              <CodeInput
                {...controlProps}
                readOnly
                length={digits}
                value={phase.issued.code}
                onValueChange={() => undefined}
              />
            )}
          </FormField>
          {/* aria-live="off": el contador se actualiza cada segundo sin anunciarse. */}
          <p
            ref={phaseNoticeRef}
            tabIndex={-1}
            role="timer"
            aria-live="off"
            className="text-sm text-text-secondary tabular-nums"
          >
            {t('totp.code.expiresIn', { ns: 'credentials', seconds: phase.secondsLeft })}
          </p>
          {phase.issued.nextCode === undefined ? null : (
            <FormField
              label={t('totp.code.next', { ns: 'credentials' })}
              help={t('totp.code.nextHelp', { ns: 'credentials' })}
            >
              {(controlProps) => (
                <CodeInput
                  {...controlProps}
                  readOnly
                  length={digits}
                  value={phase.issued.nextCode ?? ''}
                  onValueChange={() => undefined}
                />
              )}
            </FormField>
          )}
          <p className="text-sm text-text-secondary">
            {t('totp.code.clipboardNote', { ns: 'credentials', seconds: CLIPBOARD_CLEAR_SECONDS })}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <CopyButton
              value={phase.issued.code}
              label={t('totp.code.copy', { ns: 'credentials' })}
              copiedLabel={t('clipboard.copied', { ns: 'common' })}
              failedLabel={t('clipboard.failed', { ns: 'common' })}
              clearAfterMs={CLIPBOARD_CLEAR_MS}
            />
            <Button
              onClick={() => {
                setPhase({ kind: 'hidden' });
              }}
            >
              {t('totp.code.hideNow', { ns: 'credentials' })}
            </Button>
          </div>
        </>
      ) : (
        <>
          {phase.kind === 'expired' ? (
            // Párrafo y no Alert: el foco ya lo anuncia; un role="alert" lo repetiría.
            <p
              ref={phaseNoticeRef}
              tabIndex={-1}
              className="rounded-md border border-border-strong px-4 py-3 text-sm text-text"
            >
              {t('totp.code.expired', { ns: 'credentials' })}
            </p>
          ) : null}
          {phase.kind === 'hidden' ? (
            <p
              ref={phaseNoticeRef}
              tabIndex={-1}
              className="rounded-md border border-border-strong px-4 py-3 text-sm text-text"
            >
              {t('totp.code.status.hidden', { ns: 'credentials' })}
            </p>
          ) : null}
          {phase.kind === 'idle' ? (
            <p className="text-sm text-text-secondary">
              {t('totp.code.description', { ns: 'credentials' })}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              loading={action.pending}
              disabled={cooldown.secondsLeft > 0}
              onClick={() => {
                void getCode();
              }}
            >
              {phase.kind === 'expired'
                ? t('totp.code.again', { ns: 'credentials' })
                : t('totp.code.get', { ns: 'credentials' })}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
