import { loginRequestSchema, type LoginResponse } from '@iam/contracts';
import { Button, FormField, Input, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';

export type LoginPageProps = {
  /** La sesión quedó "a medias": el router lleva al código MFA o al enrolamiento. */
  onNext: (status: LoginResponse['status'], extra: { passkeys: boolean | undefined }) => void;
};

type Values = { email: string; password: string };

/**
 * Container de `/login` en dos pasos, como el diseño de Compass: primero el correo y luego la
 * contraseña (con el correo arriba y "Cambiar"). Es solo presentación: la petición sigue siendo una
 * sola con los dos datos, y el segundo factor es el paso siguiente.
 */
export function LoginPage({ onNext }: LoginPageProps) {
  const { t } = useTranslation(['auth', 'errors', 'common']);
  const queryClient = useQueryClient();
  const validationMessage = useValidationMessage();
  const login = useAsyncAction(authApi.login);
  const cooldown = useRateLimitCooldown(login.error);
  const [step, setStep] = useState<'email' | 'password'>('email');
  const {
    register,
    handleSubmit,
    setError,
    getFieldState,
    setFocus,
    setValue,
    trigger,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const values = useWatch({ control });

  // Al cambiar de paso, el foco va al campo de ese paso (el anterior ya no existe).
  useEffect(() => {
    setFocus(step === 'email' ? 'email' : 'password');
  }, [step, setFocus]);

  async function continueToPassword() {
    if (await trigger('email')) setStep('password');
  }

  function changeEmail() {
    login.reset();
    setValue('password', '');
    setStep('email');
  }

  async function submit(credentials: Values) {
    const result = await login.run(credentials);
    if (result.ok) {
      // El estado de sesión cambió (ahora hay una sesión a medias): se descarta el `/me` en caché.
      resetSession(queryClient);
      onNext(result.value.status, { passkeys: result.value.passkeys });
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
      // Un error del correo se corrige en el primer paso.
      if (getFieldState('email').invalid) setStep('email');
    }
  }

  const passwordStep = step === 'password';

  return (
    <AuthCard
      title={t(passwordStep ? 'login.passwordTitle' : 'login.title', { ns: 'auth' })}
      description={t(passwordStep ? 'login.passwordDescription' : 'login.description', {
        ns: 'auth',
      })}
    >
      <form
        noValidate
        onSubmit={(event) => {
          if (passwordStep) {
            void handleSubmit(submit)(event);
          } else {
            event.preventDefault();
            void continueToPassword();
          }
        }}
        className="flex flex-col gap-4"
      >
        {login.error !== undefined ? (
          <ErrorAlert error={login.error} secondsLeft={cooldown.secondsLeft} />
        ) : null}
        {passwordStep ? (
          <div className="flex items-center gap-3 rounded-md border border-border-strong bg-surface px-3 py-2">
            {/* El correo sigue en el formulario para los gestores de contraseñas (autocompletar). */}
            <input
              {...register('email')}
              type="email"
              autoComplete="username"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-text">{values.email}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-accent"
              aria-label={t('login.changeLabel', { ns: 'auth' })}
              onClick={changeEmail}
            >
              {t('login.change', { ns: 'auth' })}
            </Button>
          </div>
        ) : (
          <FormField
            label={t('login.email', { ns: 'auth' })}
            required
            error={validationMessage(errors.email, {
              field: 'email',
              empty: (values.email ?? '') === '',
            })}
          >
            {(field) => (
              <Input
                {...field}
                {...register('email')}
                type="email"
                autoComplete="username"
                invalid={field['aria-invalid'] === true}
              />
            )}
          </FormField>
        )}
        {passwordStep ? (
          <FormField
            label={t('login.password', { ns: 'auth' })}
            required
            error={validationMessage(errors.password, {
              field: 'password',
              empty: (values.password ?? '') === '',
            })}
          >
            {(field) => (
              <PasswordInput
                {...field}
                {...register('password')}
                autoComplete="current-password"
                invalid={field['aria-invalid'] === true}
                showLabel={t('password.show', { ns: 'common' })}
                hideLabel={t('password.hide', { ns: 'common' })}
              />
            )}
          </FormField>
        ) : null}
        <Button type="submit" loading={login.pending} disabled={cooldown.secondsLeft > 0}>
          {t(passwordStep ? 'login.submit' : 'login.continue', { ns: 'auth' })}
        </Button>
      </form>
    </AuthCard>
  );
}
