import { ErrorCode, changePasswordRequestSchema, type ChangePasswordRequest } from '@iam/contracts';
import { Button, FormField, PasswordInput, Spinner } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { resetSession, sessionQueryOptions, type SessionState } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';
import { PasswordStrength } from '../ui/password-strength';

export type PasswordChangePageProps = {
  /** La contraseña cambió: la ruta navega según el estado que devuelve `/me`. */
  onChanged: (state: SessionState) => void;
  /** Enlace para volver a `/login` (lo arma la ruta). */
  footer?: ReactNode;
};

/**
 * Container de `/password/change`: la contraseña inicial de la Raíz es de un solo uso, así que
 * se cambia con la sesión a medias y antes de registrar el segundo factor. Las contraseñas viven
 * solo en el estado del formulario y viajan en el cuerpo de un `POST` (`useAsyncAction`, sin
 * caché de Query ni almacenamiento). El medidor de fortaleza calcula en el navegador.
 */
export function PasswordChangePage({ onChanged, footer }: PasswordChangePageProps) {
  const { t } = useTranslation(['auth', 'errors', 'common']);
  const queryClient = useQueryClient();
  const validationMessage = useValidationMessage();
  const change = useAsyncAction(authApi.changePassword);
  const proceed = useAsyncAction(() =>
    // `staleTime: 0`: el estado debe ser el de DESPUÉS del cambio, nunca uno en caché.
    queryClient.query({ ...sessionQueryOptions(), staleTime: 0 }),
  );
  const cooldown = useRateLimitCooldown(change.error);
  // Tras el éxito el formulario se desmonta: las contraseñas dejan de estar en memoria.
  const [changed, setChanged] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const [currentPassword, newPassword] = useWatch({
    control,
    name: ['currentPassword', 'newPassword'],
  });

  // El foco entra al primer campo al llegar (sincroniza con el DOM, no deriva estado).
  useEffect(() => {
    setFocus('currentPassword');
  }, [setFocus]);

  async function advance() {
    const next = await proceed.run();
    if (next.ok) onChanged(next.value);
  }

  async function submit(values: ChangePasswordRequest) {
    const result = await change.run(values);
    if (result.ok) {
      // La sesión cambió de estado: se descarta el `/me` en caché y se consulta de nuevo.
      resetSession(queryClient);
      setChanged(true);
      await advance();
      return;
    }
    const { error } = result;
    if (!(error instanceof ApiError)) return;
    const fieldMessage = fieldErrorMessage(error.code);
    if (fieldMessage !== undefined) {
      // Estos errores pertenecen a un campo concreto: se muestran ahí y el foco va a él.
      setError(
        fieldMessage.field,
        { type: 'server', message: t(fieldMessage.key, { ns: fieldMessage.ns }) },
        { shouldFocus: true },
      );
      change.reset();
      return;
    }
    if (
      applyFieldErrors(
        error,
        setError,
        ['currentPassword', 'newPassword'],
        t('VALIDATION.FAILED', { ns: 'errors' }),
      )
    ) {
      change.reset();
    }
  }

  const title = t('passwordChange.title', { ns: 'auth' });

  if (changed) {
    return (
      <AuthCard title={title}>
        {proceed.error !== undefined ? (
          <ErrorAlert
            error={proceed.error}
            onRetry={() => {
              void advance();
            }}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner label={t('passwordChange.loading', { ns: 'auth' })} />
            <span aria-hidden="true">{t('passwordChange.loading', { ns: 'auth' })}</span>
          </div>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} description={t('passwordChange.description', { ns: 'auth' })}>
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(submit)(event);
        }}
        className="flex flex-col gap-4"
      >
        {change.error !== undefined ? (
          <ErrorAlert error={change.error} secondsLeft={cooldown.secondsLeft} />
        ) : null}
        <FormField
          label={t('passwordChange.current', { ns: 'auth' })}
          required
          error={validationMessage(errors.currentPassword, {
            field: 'currentPassword',
            empty: currentPassword === '',
          })}
        >
          {(field) => (
            <PasswordInput
              {...field}
              {...register('currentPassword')}
              autoComplete="current-password"
              invalid={field['aria-invalid'] === true}
              showLabel={t('password.show', { ns: 'common' })}
              hideLabel={t('password.hide', { ns: 'common' })}
            />
          )}
        </FormField>
        <FormField
          label={t('passwordChange.new', { ns: 'auth' })}
          help={t('passwordChange.newHelp', { ns: 'auth' })}
          required
          error={validationMessage(errors.newPassword, {
            field: 'password',
            empty: newPassword === '',
          })}
        >
          {(field) => (
            <PasswordInput
              {...field}
              {...register('newPassword')}
              autoComplete="new-password"
              invalid={field['aria-invalid'] === true}
              showLabel={t('password.show', { ns: 'common' })}
              hideLabel={t('password.hide', { ns: 'common' })}
            />
          )}
        </FormField>
        <PasswordStrength password={newPassword} />
        <Button type="submit" loading={change.pending} disabled={cooldown.secondsLeft > 0}>
          {t('passwordChange.submit', { ns: 'auth' })}
        </Button>
      </form>
      {footer}
    </AuthCard>
  );
}

/** Errores del servidor que se atribuyen a un campo del formulario, con su texto traducido. */
function fieldErrorMessage(
  code: string,
): { field: keyof ChangePasswordRequest; key: string; ns: 'auth' | 'errors' } | undefined {
  switch (code) {
    // Un 401 de credenciales aquí significa "la contraseña ACTUAL no es correcta".
    case ErrorCode.AUTH_INVALID_CREDENTIALS:
      return { field: 'currentPassword', key: 'passwordChange.currentIncorrect', ns: 'auth' };
    case ErrorCode.PASSWORD_WEAK:
      return { field: 'newPassword', key: ErrorCode.PASSWORD_WEAK, ns: 'errors' };
    case ErrorCode.PASSWORD_REUSED:
      return { field: 'newPassword', key: ErrorCode.PASSWORD_REUSED, ns: 'errors' };
    default:
      return undefined;
  }
}
