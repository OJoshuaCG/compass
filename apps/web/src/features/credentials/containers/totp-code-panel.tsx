import type { Credential } from '@iam/contracts';
import { Alert, Button, CodeInput, CopyButton, FormField } from '@iam/ui';
import { useEffect, useId, useState } from 'react';
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
  | { kind: 'expired' };

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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base text-text">
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
          <p role="timer" className="text-sm text-text-secondary tabular-nums">
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
                setPhase({ kind: 'idle' });
              }}
            >
              {t('totp.code.hideNow', { ns: 'credentials' })}
            </Button>
          </div>
        </>
      ) : (
        <>
          {phase.kind === 'expired' ? (
            <Alert tone="info">{t('totp.code.expired', { ns: 'credentials' })}</Alert>
          ) : (
            <p className="text-sm text-text-secondary">
              {t('totp.code.description', { ns: 'credentials' })}
            </p>
          )}
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
