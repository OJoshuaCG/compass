import { ErrorCode, type Credential } from '@iam/contracts';
import { Alert, Button, FormField, Input, PasswordInput } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { registerTotp } from '../api/totp-api';
import { buildOtpauthUri, TOTP_PREVIOUS_SECRET_RETENTION_DAYS } from '../model/totp-model';

export type TotpRegisterFormProps = {
  credential: Credential;
  /** `true` cuando ya había un segundo factor: avisa de que el anterior se conserva. */
  isReRegistration: boolean;
  /** Solo se ofrece al re-registrar; sin segundo factor no hay a dónde volver. */
  onCancel: (() => void) | undefined;
  onRegistered: () => void;
};

/**
 * Registro por clave manual: la persona pega el enlace `otpauth://` o la clave Base32 que la
 * plataforma muestra en "¿No puedes escanear el código?". No se lee ninguna imagen. La clave vive
 * solo en el estado de este formulario y se descarta al enviar o al desmontar; nunca pasa por
 * Query, la URL, el almacenamiento ni la consola.
 */
export function TotpRegisterForm({
  credential,
  isReRegistration,
  onCancel,
  onRegistered,
}: TotpRegisterFormProps) {
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const [secretOrUri, setSecretOrUri] = useState('');
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  // La validación empieza al enviar; después responde en vivo a cada cambio.
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((otpauthUri: string) => registerTotp(credential.id, otpauthUri));
  const cooldown = useRateLimitCooldown(action.error);

  const candidateUri = buildOtpauthUri({
    secretOrUri,
    issuer,
    account,
    fallbackLabel: credential.label,
  });
  const apiError = action.error instanceof ApiError ? action.error : undefined;
  const serverRejectedUri = apiError?.code === ErrorCode.CREDENTIAL_TOTP_URI_INVALID;
  const clientRejectedUri = submitted && candidateUri === null;
  const secretError =
    clientRejectedUri || serverRejectedUri
      ? t('CREDENTIAL.TOTP_URI_INVALID', { ns: 'errors' })
      : undefined;

  async function submit() {
    setSubmitted(true);
    if (candidateUri === null) return;
    const result = await action.run(candidateUri);
    if (!result.ok) return;
    setSecretOrUri('');
    onRegistered();
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
      {isReRegistration ? (
        <Alert tone="info">
          {t('totp.register.reRegisterNote', {
            ns: 'credentials',
            days: TOTP_PREVIOUS_SECRET_RETENTION_DAYS,
          })}
        </Alert>
      ) : null}
      {action.error !== undefined && !serverRejectedUri ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('totp.register.secret', { ns: 'credentials' })}
        help={t('totp.register.secretHelp', { ns: 'credentials' })}
        error={secretError}
        required
      >
        {(controlProps) => (
          <PasswordInput
            {...controlProps}
            value={secretOrUri}
            autoComplete="off"
            spellCheck={false}
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
            invalid={controlProps['aria-invalid'] === true}
            onChange={(event) => {
              setSecretOrUri(event.target.value);
              if (action.error !== undefined) action.reset();
            }}
          />
        )}
      </FormField>
      <FormField
        label={t('totp.register.issuer', { ns: 'credentials' })}
        help={t('totp.register.labelHelp', { ns: 'credentials' })}
      >
        {(controlProps) => (
          <Input
            {...controlProps}
            value={issuer}
            autoComplete="off"
            onChange={(event) => {
              setIssuer(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label={t('totp.register.account', { ns: 'credentials' })}>
        {(controlProps) => (
          <Input
            {...controlProps}
            value={account}
            autoComplete="off"
            onChange={(event) => {
              setAccount(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        {onCancel === undefined ? null : (
          <Button variant="secondary" onClick={onCancel}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
        )}
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('totp.register.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}
