import { Spinner } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { authApi, isPasswordChangeRequired } from '../api/auth-api';
import { generateQrDataUrl } from '../model/qr';
import { AuthCard } from '../ui/auth-card';
import { RecoveryCodesPanel } from '../ui/recovery-codes-panel';
import { SingleCodeForm } from '../ui/single-code-form';
import { TotpSetupPanel } from '../ui/totp-setup-panel';

export type EnrollPageProps = {
  /** Se llama tras confirmar que se guardaron los códigos; la sesión ya es completa. */
  onDone: () => void;
  /** El servidor exige cambiar la contraseña inicial antes de registrar el segundo factor. */
  onPasswordChangeRequired: () => void;
};

type Setup = { secret: string; qrSrc: string };

/**
 * Container de `/enroll`: registra el TOTP (QR + clave), confirma con un código y muestra los
 * 10 códigos de recuperación una sola vez. La clave, el QR y los códigos viven SOLO en el estado
 * de este componente (no en Query ni en almacenamiento) y se descartan al continuar o desmontar.
 */
export function EnrollPage({ onDone, onPasswordChangeRequired }: EnrollPageProps) {
  const { t } = useTranslation('auth');
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  const start = useAsyncAction(async (): Promise<Setup> => {
    const enrollment = await authApi.startEnrollment();
    return { secret: enrollment.secret, qrSrc: await generateQrDataUrl(enrollment.otpauthUri) };
  });
  const confirm = useAsyncAction(authApi.confirmEnrollment);

  function begin() {
    void start.run().then((result) => {
      if (result.ok) setSetup(result.value);
      else if (isPasswordChangeRequired(result.error)) {
        start.reset();
        onPasswordChangeRequired();
      }
    });
  }

  // Un solo arranque: en desarrollo StrictMode ejecuta el efecto dos veces y cada llamada a
  // `enroll` genera una clave nueva en el servidor (la segunda invalidaría la que se muestra).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    begin();
    // `begin` solo usa funciones estables del arranque; el guard de arriba impide repetirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitCode(code: string) {
    const result = await confirm.run(code);
    if (!result.ok) {
      if (isPasswordChangeRequired(result.error)) {
        confirm.reset();
        onPasswordChangeRequired();
      }
      return;
    }
    // Ya hay sesión completa. La clave deja de ser necesaria: se descarta de inmediato.
    resetSession(queryClient);
    setSetup(null);
    setRecoveryCodes(result.value.recoveryCodes);
  }

  if (recoveryCodes !== null) {
    return (
      <AuthCard title={t('enroll.recovery.title')}>
        <RecoveryCodesPanel
          codes={recoveryCodes}
          onContinue={() => {
            setRecoveryCodes(null);
            onDone();
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('enroll.title')} description={t('enroll.description')}>
      {start.error !== undefined ? <ErrorAlert error={start.error} onRetry={begin} /> : null}
      {setup === null && start.error === undefined ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner label={t('enroll.loading')} />
          <span aria-hidden="true">{t('enroll.loading')}</span>
        </div>
      ) : null}
      {setup !== null ? (
        <>
          <TotpSetupPanel qrSrc={setup.qrSrc} secret={setup.secret} />
          <SingleCodeForm
            kind="totp"
            label={t('enroll.code')}
            submitLabel={t('enroll.confirm')}
            pending={confirm.pending}
            error={confirm.error}
            autoFocus={false}
            onSubmit={(code) => {
              void submitCode(code);
            }}
          />
        </>
      ) : null}
    </AuthCard>
  );
}
