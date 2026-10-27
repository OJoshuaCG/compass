import { Button } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';
import { SingleCodeForm } from '../ui/single-code-form';

export type MfaPageProps = {
  /** La sesión quedó completa: el router lleva a la ruta de retorno. */
  onVerified: () => void;
  /** Enlace para volver a `/login` (lo arma la ruta). */
  footer?: ReactNode;
};

/** Container de `/login/mfa`: código TOTP, con la opción de usar un código de recuperación. */
export function MfaPage({ onVerified, footer }: MfaPageProps) {
  const { t } = useTranslation('auth');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const verify = useAsyncAction(authApi.verifyMfa);
  const recover = useAsyncAction(authApi.useRecoveryCode);
  const action = mode === 'totp' ? verify : recover;

  async function submit(code: string) {
    const result = await action.run(code);
    if (!result.ok) return;
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
