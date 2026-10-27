import { loginRequestSchema, type LoginResponse } from '@iam/contracts';
import { Button, FormField, Input, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';

export type LoginPageProps = {
  /** La sesión quedó "a medias": el router lleva al código MFA o al enrolamiento. */
  onNext: (status: LoginResponse['status']) => void;
};

type Values = { email: string; password: string };

/** Container de `/login`: correo y contraseña; el segundo factor es el paso siguiente. */
export function LoginPage({ onNext }: LoginPageProps) {
  const { t } = useTranslation(['auth', 'errors', 'common']);
  const queryClient = useQueryClient();
  const validationMessage = useValidationMessage();
  const login = useAsyncAction(authApi.login);
  const cooldown = useRateLimitCooldown(login.error);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const values = useWatch({ control });

  async function submit(credentials: Values) {
    const result = await login.run(credentials);
    if (result.ok) {
      // El estado de sesión cambió (ahora hay una sesión a medias): se descarta el `/me` en caché.
      resetSession(queryClient);
      onNext(result.value.status);
      return;
    }
    if (
      applyFieldErrors(
        result.error,
        setError,
        ['email', 'password'],
        t('VALIDATION.FAILED', { ns: 'errors' }),
      )
    ) {
      login.reset();
    }
  }

  return (
    <AuthCard
      title={t('login.title', { ns: 'auth' })}
      description={t('login.description', { ns: 'auth' })}
    >
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(submit)(event);
        }}
        className="flex flex-col gap-4"
      >
        {login.error !== undefined ? (
          <ErrorAlert error={login.error} secondsLeft={cooldown.secondsLeft} />
        ) : null}
        <FormField
          label={t('login.email', { ns: 'auth' })}
          required
          error={validationMessage(errors.email, {
            field: 'email',
            empty: (values.email ?? '') === '',
          })}
        >
          {(control) => (
            <Input
              {...control}
              {...register('email')}
              type="email"
              autoComplete="username"
              invalid={control['aria-invalid'] === true}
            />
          )}
        </FormField>
        <FormField
          label={t('login.password', { ns: 'auth' })}
          required
          error={validationMessage(errors.password, {
            field: 'password',
            empty: (values.password ?? '') === '',
          })}
        >
          {(control) => (
            <PasswordInput
              {...control}
              {...register('password')}
              autoComplete="current-password"
              invalid={control['aria-invalid'] === true}
              showLabel={t('password.show', { ns: 'common' })}
              hideLabel={t('password.hide', { ns: 'common' })}
            />
          )}
        </FormField>
        <Button type="submit" loading={login.pending} disabled={cooldown.secondsLeft > 0}>
          {t('login.submit', { ns: 'auth' })}
        </Button>
      </form>
    </AuthCard>
  );
}
