import { ErrorCode } from '@iam/contracts';
import { Alert, Badge, Button, FormField, Input } from '@iam/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import {
  fetchInboundMailPreviewStatus,
  readInboundMailPreview,
  requestInboundMailPreview,
} from '../api/inbound-api';
import {
  mailPreviewFailureCode,
  MAIL_PREVIEW_POLL_INTERVAL_MS,
  MAIL_PREVIEW_POLL_MAX_ATTEMPTS,
  type InboundMailPreviewKind,
  type MailPreviewFailureCode,
} from '../model/inbound-mail-preview-policy';
import {
  isRevealReasonValid,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
  revealReasonLength,
} from '../model/inbound-reset-policy';

type WorkingStep = 'requesting' | 'waiting' | 'reading';
type Stage = 'request' | 'poll' | 'read';

/**
 * Fases del diálogo. El cuerpo vive SOLO en la fase `body` y el asunto en el estado `subject`, es decir, en
 * el estado de este componente: no pasan por Query, la URL, el almacenamiento ni la consola, y se descartan
 * cuando el diálogo se cierra y el componente se desmonta.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'reason' }
  | { kind: 'working'; step: WorkingStep }
  | { kind: 'slow'; previewKind: InboundMailPreviewKind; reason: string | undefined }
  | { kind: 'failed'; code: MailPreviewFailureCode }
  | { kind: 'gone' }
  | {
      kind: 'error';
      stage: 'poll' | 'read';
      previewKind: InboundMailPreviewKind;
      reason: string | undefined;
      error: unknown;
    }
  | { kind: 'body'; content: string };

type PollOutcome =
  | { kind: 'ready' }
  | { kind: 'failed'; code: MailPreviewFailureCode }
  | { kind: 'gone' }
  | { kind: 'slow' }
  | { kind: 'cancelled' };

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/** Caja opaca de «valor revelado» (§4.1): `bg-raised`, mono y acento; siempre texto plano. */
const REVEALED_CONTENT_CLASS =
  'whitespace-pre-wrap break-words rounded-md border border-border-strong bg-raised p-3 font-mono text-sm text-accent';

export type InboundMailPreviewContentProps = {
  receiptId: string;
  /** Solo comodidad: el servidor vuelve a exigir `inbound.reveal_reset` y el motivo. */
  canViewBody: boolean;
  onClose: () => void;
};

/**
 * Contenido del diálogo «Ver correo»: asunto (confirma qué mensaje es) y, si se tiene permiso, el cuerpo
 * completo con motivo escrito. Flujo: pedir, consultar hasta que el worker lo deje listo, leer y mostrar.
 * La lectura es única en el servidor, así que no se reintenta a ciegas: un fallo al leer se ofrece
 * reintentar solo si el servidor no llegó a entregar (cualquier error distinto de NOT_FOUND).
 */
export function InboundMailPreviewContent({
  receiptId,
  canViewBody,
  onClose,
}: InboundMailPreviewContentProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [subject, setSubject] = useState<string | undefined>(undefined);
  const [reasonText, setReasonText] = useState('');
  // La validación del motivo empieza al enviar; después responde en vivo a cada cambio.
  const [reasonSubmitted, setReasonSubmitted] = useState(false);
  const [requestError, setRequestError] = useState<unknown>(undefined);
  const cooldown = useRateLimitCooldown(requestError);

  const noticeRef = useRef<HTMLDivElement>(null);
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const previousPhaseKind = useRef<Phase['kind']>('idle');
  // Cada ejecución lleva un número; al desmontar o cerrar se invalida y su resultado tardío se descarta
  // (el servidor sí lo habrá auditado; eso es correcto, porque la lectura ocurrió).
  const runIdRef = useRef(0);

  useEffect(
    () => () => {
      runIdRef.current += 1;
    },
    [],
  );

  // Tras cada cambio de fase el botón pulsado se desmontó: el foco va al aviso de la fase o, en el
  // formulario del motivo, al campo (WCAG 2.4.3). Ningún aviso contiene el contenido del correo.
  const phaseKind = phase.kind;
  useEffect(() => {
    if (previousPhaseKind.current === phaseKind) return;
    previousPhaseKind.current = phaseKind;
    if (phaseKind === 'reason') {
      reasonInputRef.current?.focus();
      return;
    }
    noticeRef.current?.focus();
  }, [phaseKind]);

  function isCurrent(runId: number): boolean {
    return runIdRef.current === runId;
  }

  async function pollUntilReady(
    runId: number,
    previewKind: InboundMailPreviewKind,
  ): Promise<PollOutcome> {
    for (let attempt = 0; attempt < MAIL_PREVIEW_POLL_MAX_ATTEMPTS; attempt += 1) {
      // La primera consulta es inmediata; las demás esperan el intervalo.
      if (attempt > 0) await sleep(MAIL_PREVIEW_POLL_INTERVAL_MS);
      if (!isCurrent(runId)) return { kind: 'cancelled' };
      const response = await fetchInboundMailPreviewStatus(receiptId, previewKind);
      if (!isCurrent(runId)) return { kind: 'cancelled' };
      const state = response.data;
      if (state === null) return { kind: 'gone' };
      if (state.status === 'ready') return { kind: 'ready' };
      if (state.status === 'failed') {
        return { kind: 'failed', code: mailPreviewFailureCode(state.resultCode) };
      }
    }
    return { kind: 'slow' };
  }

  /** Recorre las etapas desde `from`; cada fallo se atribuye a la etapa en la que ocurrió. */
  async function deliver(
    previewKind: InboundMailPreviewKind,
    reason: string | undefined,
    from: Stage,
  ): Promise<void> {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    let stage: Stage = from;
    try {
      if (stage === 'request') {
        setPhase({ kind: 'working', step: 'requesting' });
        await requestInboundMailPreview(receiptId, previewKind, reason);
        if (!isCurrent(runId)) return;
        stage = 'poll';
      }
      if (stage === 'poll') {
        setPhase({ kind: 'working', step: 'waiting' });
        const outcome = await pollUntilReady(runId, previewKind);
        if (outcome.kind === 'cancelled') return;
        if (outcome.kind === 'failed') {
          setPhase({ kind: 'failed', code: outcome.code });
          return;
        }
        if (outcome.kind === 'gone') {
          setPhase({ kind: 'gone' });
          return;
        }
        if (outcome.kind === 'slow') {
          setPhase({ kind: 'slow', previewKind, reason });
          return;
        }
        stage = 'read';
      }
      setPhase({ kind: 'working', step: 'reading' });
      const delivered = await readInboundMailPreview(receiptId, previewKind, reason);
      if (!isCurrent(runId)) return;
      if (previewKind === 'subject') {
        setSubject(delivered.data.content);
        setPhase({ kind: 'idle' });
      } else {
        setPhase({ kind: 'body', content: delivered.data.content });
      }
    } catch (error) {
      if (!isCurrent(runId)) return;
      if (stage === 'request') {
        setRequestError(error);
        setPhase(previewKind === 'body' ? { kind: 'reason' } : { kind: 'idle' });
        return;
      }
      // Lectura única: NOT_FOUND significa que ya se entregó o venció; no hay nada que reintentar.
      if (stage === 'read' && error instanceof ApiError && error.code === ErrorCode.NOT_FOUND) {
        setPhase({ kind: 'gone' });
        return;
      }
      setPhase({ kind: 'error', stage, previewKind, reason, error });
    }
  }

  function backToStart() {
    setRequestError(undefined);
    setPhase({ kind: 'idle' });
  }

  function submitReason() {
    setReasonSubmitted(true);
    if (!isRevealReasonValid(reasonText) || cooldown.secondsLeft > 0) return;
    setRequestError(undefined);
    void deliver('body', reasonText.trim(), 'request');
  }

  const requestApiError = requestError instanceof ApiError ? requestError : undefined;
  const serverRejectedReason = requestApiError?.code === ErrorCode.CREDENTIAL_REASON_INVALID;
  const reasonRejected =
    (reasonSubmitted && !isRevealReasonValid(reasonText)) || serverRejectedReason;
  const requestErrorAlert =
    requestError !== undefined && !serverRejectedReason ? (
      <ErrorAlert error={requestError} secondsLeft={cooldown.secondsLeft} />
    ) : null;

  const workingText: Record<WorkingStep, string> = {
    requesting: t('mailPreview.status.requesting'),
    waiting: t('mailPreview.status.waiting'),
    reading: t('mailPreview.status.reading'),
  };

  return (
    <div className="flex flex-col gap-4">
      {subject !== undefined ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm text-text-secondary">{t('mailPreview.subject.label')}</h3>
          {/* Texto plano: React escapa el contenido; nunca HTML ni enlaces activos. */}
          <p className={REVEALED_CONTENT_CLASS}>{subject}</p>
        </section>
      ) : null}

      {phase.kind === 'idle' ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">{t('mailPreview.audited')}</p>
          {requestErrorAlert}
          <div className="flex flex-wrap justify-end gap-3">
            {subject === undefined ? (
              <Button
                disabled={cooldown.secondsLeft > 0}
                onClick={() => {
                  setRequestError(undefined);
                  void deliver('subject', undefined, 'request');
                }}
              >
                {t('mailPreview.subject.action')}
              </Button>
            ) : null}
            {canViewBody ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setRequestError(undefined);
                  setPhase({ kind: 'reason' });
                }}
              >
                {t('mailPreview.body.action')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'reason' ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submitReason();
          }}
          className="flex flex-col gap-4"
        >
          <Alert tone="warning">{t('mailPreview.body.warning')}</Alert>
          {requestErrorAlert}
          <FormField
            label={t('mailPreview.body.reason')}
            required
            help={t('mailPreview.body.counter', {
              length: revealReasonLength(reasonText),
              max: REVEAL_REASON_MAX_LENGTH,
              min: REVEAL_REASON_MIN_LENGTH,
            })}
            error={reasonRejected ? t('CREDENTIAL.REASON_INVALID', { ns: 'errors' }) : undefined}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                ref={reasonInputRef}
                value={reasonText}
                maxLength={REVEAL_REASON_MAX_LENGTH}
                autoComplete="off"
                invalid={controlProps['aria-invalid'] === true}
                onChange={(event) => {
                  setReasonText(event.target.value);
                  // El rechazo del servidor se refería al motivo anterior; al corregirlo deja de aplicar.
                  if (serverRejectedReason) setRequestError(undefined);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={backToStart}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={cooldown.secondsLeft > 0}>
              {t('mailPreview.body.submit')}
            </Button>
          </div>
        </form>
      ) : null}

      {phase.kind === 'working' ? (
        <div ref={noticeRef} tabIndex={-1} role="status" className="flex flex-col gap-2">
          <Badge dot tone="warning" className="self-start">
            {t('mailPreview.status.pending')}
          </Badge>
          <p className="text-sm text-text-secondary">{workingText[phase.step]}</p>
        </div>
      ) : null}

      {phase.kind === 'slow' ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <p role="status" className="text-sm text-text-secondary">
            {t('mailPreview.status.slow')}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
            <Button
              onClick={() => {
                void deliver(phase.previewKind, phase.reason, 'poll');
              }}
            >
              {t('mailPreview.status.recheck')}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <div role="status" className="flex flex-col items-start gap-2">
            <Badge dot tone="danger">
              {t('mailPreview.status.failed')}
            </Badge>
            <p className="text-sm text-text-secondary">{t(`mailPreview.result.${phase.code}`)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
            <Button onClick={backToStart}>{t('mailPreview.status.retry')}</Button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'gone' ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <p role="status" className="text-sm text-text-secondary">
            {t('mailPreview.status.gone')}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
            <Button onClick={backToStart}>{t('mailPreview.status.retry')}</Button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'error' ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <ErrorAlert
            error={phase.error}
            onRetry={() => {
              void deliver(phase.previewKind, phase.reason, phase.stage);
            }}
          />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'body' ? (
        <div className="flex flex-col gap-3">
          <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-1">
            <p className="text-sm text-text-secondary">{t('mailPreview.shown.notice')}</p>
            <p className="text-sm text-text-secondary">{t('mailPreview.shown.plainText')}</p>
          </div>
          <section className="flex flex-col gap-1">
            <h3 className="text-sm text-text-secondary">{t('mailPreview.body.label')}</h3>
            {/* Región con tabIndex para que el teclado pueda desplazar un cuerpo largo. */}
            <div
              role="region"
              aria-label={t('mailPreview.body.label')}
              tabIndex={0}
              className={`max-h-64 overflow-y-auto ${REVEALED_CONTENT_CLASS}`}
            >
              {phase.content}
            </div>
          </section>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('actions.close', { ns: 'common' })}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
