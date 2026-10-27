import { Alert, Button } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { authApi, isPasswordChangeRequired } from '../api/auth-api';
import { signInWithPasskey } from '../api/passkey-sign-in';
import { AuthCard } from '../ui/auth-card';
import { SingleCodeForm } from '../ui/single-code-form';

export type MfaPageProps = {
  /** La sesión quedó completa: el router lleva a la ruta de retorno. */
  onVerified: () => void;
  /** El servidor exige cambiar la contraseña inicial antes del segundo factor. */
  onPasswordChangeRequired: () => void;
  /**
   * La persona tiene passkeys (lo dijo el ingreso). `undefined` = se desconoce (recarga, o llegó
   * tras cambiar la contraseña): se ofrece igual, y el servidor responde 401 si no hay ninguna.
   * `false` = se sabe que no tiene: no se ofrece.
   */
  passkeys?: boolean | undefined;
  /** Enlace para volver a `/login` (lo arma la ruta). */
  footer?: ReactNode;
};

/** Container de `/login/mfa`: código TOTP, con la opción de usar un código de recuperación. */
export function MfaPage({ onVerified, onPasswordChangeRequired, passkeys, footer }: MfaPageProps) {
  const { t } = useTranslation('auth');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const verify = useAsyncAction(authApi.verifyMfa);
  const recover = useAsyncAction(authApi.useRecoveryCode);
  const passkey = useAsyncAction(() => signInWithPasskey(authApi));
  const passkeyCooldown = useRateLimitCooldown(passkey.error);
  const [cancelled, setCancelled] = useState(false);
  const action = mode === 'totp' ? verify : recover;

  async function startPasskey() {
    setCancelled(false);
    const result = await passkey.run();
    if (!result.ok) {
      if (isPasswordChangeRequired(result.error)) {
        passkey.reset();
        onPasswordChangeRequired();
      }
      return;
    }
    // Cancelar el aviso del navegador no es un error: se avisa en neutro y se queda en la pantalla.
    if (result.value === 'cancelled') {
      setCancelled(true);
      return;
    }
    resetSession(queryClient);
    onVerified();
  }

  async function submit(code: string) {
    const result = await action.run(code);
    if (!result.ok) {
      if (isPasswordChangeRequired(result.error)) {
        // No es un fallo del código: falta un paso previo. Se limpia el error y se redirige.
        action.reset();
        onPasswordChangeRequired();
      }
      return;
    }
    resetSession(queryClient);
    onVerified();
  }

  return (
    <AuthCard
      title={mode === 'totp' ? t('mfa.title') : t('recovery.title')}
      description={mode === 'totp' ? t('mfa.description') : t('recovery.description')}
    >
      {/* `key` reinicia el formulario (y su código) al alternar de modo. */}
      <SingleCodeForm
        key={mode}
        kind={mode}
        label={mode === 'totp' ? t('mfa.code') : t('recovery.code')}
        submitLabel={mode === 'totp' ? t('mfa.submit') : t('recovery.submit')}
        pending={action.pending}
        error={action.error}
        onSubmit={(code) => {
          void submit(code);
        }}
      />
      {passkeys !== false ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {passkey.error instanceof ApiError ? (
            <ErrorAlert error={passkey.error} secondsLeft={passkeyCooldown.secondsLeft} />
          ) : passkey.error !== undefined ? (
            // Fallo del navegador o del autenticador (no de la API): no hay código que traducir.
            <Alert tone="danger">{t('generic', { ns: 'errors' })}</Alert>
          ) : null}
          {cancelled ? <Alert tone="info">{t('mfa.passkeyCancelled')}</Alert> : null}
          <Button
            variant="secondary"
            loading={passkey.pending}
            disabled={passkeyCooldown.secondsLeft > 0}
            onClick={() => {
              void startPasskey();
            }}
          >
            {t('mfa.usePasskey')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            verify.reset();
            recover.reset();
            setMode(mode === 'totp' ? 'recovery' : 'totp');
          }}
        >
          {mode === 'totp' ? t('mfa.useRecovery') : t('recovery.useApp')}
        </Button>
        {footer}
      </div>
    </AuthCard>
  );
}
