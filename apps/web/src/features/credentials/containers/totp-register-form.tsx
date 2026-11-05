import { ErrorCode, type Credential } from '@iam/contracts';
import { Alert, Button, FormField, Input, PasswordInput, Tabs } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { registerTotp } from '../api/totp-api';
import { buildOtpauthUri, TOTP_PREVIOUS_SECRET_RETENTION_DAYS } from '../model/totp-model';

import { TotpQrReader } from './totp-qr-reader';

type RegisterMethod = 'key' | 'image';

export type TotpRegisterFormProps = {
  credential: Credential;
  /** `true` cuando ya había un segundo factor: avisa de que el anterior se conserva. */
  isReRegistration: boolean;
  /** Solo se ofrece al re-registrar; sin segundo factor no hay a dónde volver. */
  onCancel: (() => void) | undefined;
  onRegistered: () => void;
};

/**
 * Registro del segundo factor por dos métodos que terminan en el mismo envío: la clave manual (la
 * persona pega el enlace `otpauth://` o la clave Base32 que la plataforma muestra en "¿No puedes
 * escanear el código?") o la imagen del QR, que se lee en el navegador. La clave o el enlace viven
 * solo en el estado de este formulario y se descartan al enviar, al cambiar de método o al
 * desmontar; nunca pasan por Query, la URL, el almacenamiento ni la consola.
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
  const [method, setMethod] = useState<RegisterMethod>('key');
  // Enlace leído de la imagen. Se descarta al cambiar de método: el lector se desmonta y su aviso
  // de "QR leído" desaparece, así que el enlace no puede quedar enviable sin que se vea.
  const [qrUri, setQrUri] = useState<string | null>(null);
  // La validación empieza al enviar; después responde en vivo a cada cambio.
  const [submitted, setSubmitted] = useState(false);
  const action = useAsyncAction((otpauthUri: string) => registerTotp(credential.id, otpauthUri));
  const cooldown = useRateLimitCooldown(action.error);

  const isImageMethod = method === 'image';
  // El enlace del QR pasa por la misma validación del contrato que el pegado a mano.
  const candidateUri = buildOtpauthUri({
    secretOrUri: isImageMethod ? (qrUri ?? '') : secretOrUri,
    issuer: isImageMethod ? '' : issuer,
    account: isImageMethod ? '' : account,
    fallbackLabel: credential.label,
  });
  const apiError = action.error instanceof ApiError ? action.error : undefined;
  const serverRejectedUri = apiError?.code === ErrorCode.CREDENTIAL_TOTP_URI_INVALID;
  // Con imagen no hay campo donde marcar el error: se muestra en el aviso general.
  const fieldShowsUriError = !isImageMethod;
  const clientRejectedUri = submitted && fieldShowsUriError && candidateUri === null;
  const secretError =
    clientRejectedUri || (serverRejectedUri && fieldShowsUriError)
      ? t('CREDENTIAL.TOTP_URI_INVALID', { ns: 'errors' })
      : undefined;

  function resetActionError() {
    if (action.error !== undefined) action.reset();
  }

  async function submit() {
    setSubmitted(true);
    if (candidateUri === null) return;
    const result = await action.run(candidateUri);
    if (!result.ok) return;
    setSecretOrUri('');
    setQrUri(null);
    onRegistered();
  }

  const keyFields = (
    <div className="flex flex-col gap-4">
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
              resetActionError();
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
    </div>
  );

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
      {action.error !== undefined && (!serverRejectedUri || isImageMethod) ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <Tabs
        label={t('totp.register.method.label', { ns: 'credentials' })}
        tabs={[
          { id: 'key', label: t('totp.register.method.key', { ns: 'credentials' }) },
          { id: 'image', label: t('totp.register.method.image', { ns: 'credentials' }) },
        ]}
        value={method}
        onValueChange={(next) => {
          setMethod(next === 'image' ? 'image' : 'key');
          setQrUri(null);
          setSubmitted(false);
          resetActionError();
        }}
      >
        {isImageMethod ? (
          <TotpQrReader
            onResult={(uri) => {
              setQrUri(uri);
              resetActionError();
            }}
          />
        ) : (
          keyFields
        )}
      </Tabs>
      <div className="flex justify-end gap-3">
        {onCancel === undefined ? null : (
          <Button variant="secondary" onClick={onCancel}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
        )}
        <Button
          type="submit"
          loading={action.pending}
          disabled={cooldown.secondsLeft > 0 || (isImageMethod && candidateUri === null)}
        >
          {t('totp.register.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}
