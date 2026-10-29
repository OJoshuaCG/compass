import { confirmTotpRequestSchema, ErrorCode, type Credential } from '@iam/contracts';
import { Alert, Button, CodeInput, FormField } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { confirmTotp } from '../api/totp-api';

export type TotpConfirmFormProps = {
  credential: Credential;
  /** Dígitos del código según el estado registrado (6 u 8). */
  digits: number;
  onConfirmed: () => void;
};

/**
 * Confirmación obligatoria (docs/business/two-factor.md §4): la persona escribe el código que
 * muestra la plataforma y el servidor comprueba que coincide con la clave registrada. Solo así lo
 * pendiente pasa a verificado.
 */
export function TotpConfirmForm({ credential, digits, onConfirmed }: TotpConfirmFormProps) {
  const { t } = useTranslation(['credentials', 'errors']);
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((confirmedCode: string) =>
    confirmTotp(credential.id, confirmedCode),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const apiError = action.error instanceof ApiError ? action.error : undefined;
  const serverRejectedCode = apiError?.code === ErrorCode.CREDENTIAL_TOTP_CODE_INVALID;
  const isFormatValid =
    confirmTotpRequestSchema.safeParse({ code }).success && code.length === digits;
  const codeError = serverRejectedCode
    ? t('CREDENTIAL.TOTP_CODE_INVALID', { ns: 'errors' })
    : submitted && !isFormatValid
      ? t('totp.confirm.format', { ns: 'credentials', digits })
      : undefined;

  async function submit() {
    setSubmitted(true);
    if (!isFormatValid) return;
    const result = await action.run(code);
    if (!result.ok) return;
    setCode('');
    onConfirmed();
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
      <Alert tone="warning">{t('totp.confirm.pendingNote', { ns: 'credentials' })}</Alert>
      {action.error !== undefined && !serverRejectedCode ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('totp.confirm.code', { ns: 'credentials' })}
        help={t('totp.confirm.help', { ns: 'credentials' })}
        error={codeError}
        required
      >
        {(controlProps) => (
          <CodeInput
            {...controlProps}
            value={code}
            length={digits}
            invalid={controlProps['aria-invalid'] === true}
            onValueChange={(nextCode) => {
              setCode(nextCode);
              if (action.error !== undefined) action.reset();
            }}
          />
        )}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('totp.confirm.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}
