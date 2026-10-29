import { ErrorCode, type Credential, type ExportedTotp } from '@iam/contracts';
import { Alert, Button, CopyButton, FormField, Input, PasswordInput } from '@iam/ui';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { exportTotpSecret } from '../api/totp-api';
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
 * Fases del panel. El enlace y la clave viven SOLO en la fase `shown`, es decir, en el estado de
 * este componente: no pasan por Query, la URL, el almacenamiento ni la consola.
 */
type Phase =
  | { kind: 'closed' }
  | { kind: 'ask' }
  | { kind: 'shown'; secret: ExportedTotp }
  | { kind: 'hidden' };

type ReasonFormProps = {
  credential: Credential;
  onCancel: () => void;
  onExported: (secret: ExportedTotp) => void;
};

function ExportReasonForm({ credential, onCancel, onExported }: ReasonFormProps) {
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const [reason, setReason] = useState('');
  // La validación empieza al enviar; después responde en vivo a cada cambio.
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((trimmedReason: string) =>
    exportTotpSecret(credential.id, trimmedReason),
  );
  const cooldown = useRateLimitCooldown(action.error);

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
    if (result.ok) onExported(result.value);
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
      <Alert tone="warning">{t('totp.export.warning', { ns: 'credentials' })}</Alert>
      <Alert tone="info">{t('reveal.warning', { ns: 'credentials' })}</Alert>
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
        {(controlProps) => (
          <Input
            {...controlProps}
            value={reason}
            maxLength={REVEAL_REASON_MAX_LENGTH}
            autoComplete="off"
            invalid={controlProps['aria-invalid'] === true}
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
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('totp.export.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}

type ShownSecretProps = {
  secret: ExportedTotp;
  onHide: () => void;
};

function ShownSecret({ secret, onHide }: ShownSecretProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const showLabel = t('password.show', { ns: 'common' });
  const hideLabel = t('password.hide', { ns: 'common' });
  const copiedLabel = t('clipboard.copied', { ns: 'common' });
  const failedLabel = t('clipboard.failed', { ns: 'common' });

  return (
    <div className="flex flex-col gap-4">
      <FormField label={t('totp.export.key', { ns: 'credentials' })}>
        {(controlProps) => (
          <PasswordInput
            {...controlProps}
            readOnly
            value={secret.secretKey}
            autoComplete="off"
            showLabel={showLabel}
            hideLabel={hideLabel}
          />
        )}
      </FormField>
      <FormField label={t('totp.export.uri', { ns: 'credentials' })}>
        {(controlProps) => (
          <PasswordInput
            {...controlProps}
            readOnly
            value={secret.otpauthUri}
            autoComplete="off"
            showLabel={showLabel}
            hideLabel={hideLabel}
          />
        )}
      </FormField>
      <p className="text-sm text-text-secondary">
        {t('totp.export.autoHide', {
          ns: 'credentials',
          seconds: REVEALED_PASSWORD_VISIBLE_SECONDS,
        })}{' '}
        {t('reveal.clipboardNote', { ns: 'credentials', seconds: CLIPBOARD_CLEAR_SECONDS })}
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <CopyButton
          value={secret.secretKey}
          label={t('totp.export.copyKey', { ns: 'credentials' })}
          copiedLabel={copiedLabel}
          failedLabel={failedLabel}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
        />
        <CopyButton
          value={secret.otpauthUri}
          label={t('totp.export.copyUri', { ns: 'credentials' })}
          copiedLabel={copiedLabel}
          failedLabel={failedLabel}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
        />
        <Button onClick={onHide}>{t('totp.export.hideNow', { ns: 'credentials' })}</Button>
      </div>
    </div>
  );
}

export type TotpExportPanelProps = {
  credential: Credential;
  /** Se llama al recibir el secreto: desde ese momento la credencial queda marcada como expuesta. */
  onExported: () => void;
};

/**
 * Exportar la clave (nivel MANAGE): motivo escrito de 6 a 500 caracteres como al revelar, y el
 * enlace y la clave visibles 30 s en el estado local. La reautenticación la resuelve el cliente
 * HTTP; si se cancela, aquí se ve el mensaje. Es un evento crítico y marca el secreto como expuesto.
 */
export function TotpExportPanel({ credential, onExported }: TotpExportPanelProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });

  // Oculta a los 30 s. Al desmontar se cancela el temporizador y el estado se descarta con el
  // componente, así que cerrar el diálogo también borra la clave.
  useEffect(() => {
    if (phase.kind !== 'shown') return;
    const timer = window.setTimeout(() => {
      setPhase({ kind: 'hidden' });
    }, REVEALED_PASSWORD_VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base text-text">
        {t('totp.export.heading', { ns: 'credentials' })}
      </h3>
      {phase.kind === 'closed' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            {t('totp.export.description', { ns: 'credentials' })}
          </p>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ kind: 'ask' });
              }}
            >
              {t('totp.export.open', { ns: 'credentials' })}
            </Button>
          </div>
        </div>
      ) : null}
      {phase.kind === 'ask' ? (
        <ExportReasonForm
          credential={credential}
          onCancel={() => {
            setPhase({ kind: 'closed' });
          }}
          onExported={(secret) => {
            setPhase({ kind: 'shown', secret });
            onExported();
          }}
        />
      ) : null}
      {phase.kind === 'shown' ? (
        <ShownSecret
          secret={phase.secret}
          onHide={() => {
            setPhase({ kind: 'hidden' });
          }}
        />
      ) : null}
      {phase.kind === 'hidden' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">{t('totp.export.hidden', { ns: 'credentials' })}</Alert>
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ kind: 'ask' });
              }}
            >
              {t('totp.export.again', { ns: 'credentials' })}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
