import {
  ErrorCode,
  acceptInvitationRequestSchema,
  type InvitationPreviewResponse,
} from '@iam/contracts';
import { Alert, Button, FormField, Input, PasswordInput, Spinner } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { resetSession } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';
import { InvitationSummary } from '../ui/invitation-summary';
import { PasswordStrength } from '../ui/password-strength';

export type InvitationPageProps = {
  /** Token de un solo uso, ya extraído de la URL por la ruta (que además lo borra de ella). */
  token: string | undefined;
  /** La invitación se aceptó: hay sesión a medias y falta registrar el segundo factor. */
  onAccepted: () => void;
  /** Enlace a `/login` (lo arma la ruta). */
  footer?: ReactNode;
};

const acceptFormSchema = acceptInvitationRequestSchema.pick({ displayName: true, password: true });
type Values = { displayName: string; password: string };

type AcceptFormProps = {
  token: string;
  preview: InvitationPreviewResponse;
  onAccepted: () => void;
  onInvalid: () => void;
};

function AcceptForm({ token, preview, onAccepted, onInvalid }: AcceptFormProps) {
  const { t } = useTranslation(['auth', 'errors', 'common']);
  const queryClient = useQueryClient();
  const validationMessage = useValidationMessage();
  const accept = useAsyncAction(authApi.acceptInvitation);
  const cooldown = useRateLimitCooldown(accept.error);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(acceptFormSchema),
    defaultValues: { displayName: '', password: '' },
  });
  const [displayName, password] = useWatch({ control, name: ['displayName', 'password'] });

  async function submit(values: Values) {
    const result = await accept.run({ token, ...values });
    if (result.ok) {
      resetSession(queryClient);
      onAccepted();
      return;
    }
    const { error } = result;
    if (error instanceof ApiError) {
      if (error.code === ErrorCode.INVITATION_INVALID) {
        onInvalid();
        return;
      }
      if (error.code === ErrorCode.PASSWORD_WEAK) {
        // El error de contraseña débil se muestra en el propio campo, no como aviso general.
        setError('password', { type: 'server', message: t('PASSWORD.WEAK', { ns: 'errors' }) });
        accept.reset();
        return;
      }
      if (
        applyFieldErrors(
          error,
          setError,
          ['displayName', 'password'],
          t('VALIDATION.FAILED', { ns: 'errors' }),
        )
      ) {
        accept.reset();
      }
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4"
    >
      <InvitationSummary email={preview.email} rank={preview.rank} expiresAt={preview.expiresAt} />
      {accept.error !== undefined ? (
        <ErrorAlert error={accept.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('invitation.displayName', { ns: 'auth' })}
        required
        error={validationMessage(errors.displayName, {
          field: 'displayName',
          empty: displayName.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('displayName')}
            autoComplete="name"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('invitation.password', { ns: 'auth' })}
        help={t('invitation.passwordHelp', { ns: 'auth' })}
        required
        error={validationMessage(errors.password, { field: 'password', empty: password === '' })}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('password')}
            autoComplete="new-password"
            invalid={field['aria-invalid'] === true}
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
          />
        )}
      </FormField>
      <PasswordStrength password={password} />
      <Button type="submit" loading={accept.pending} disabled={cooldown.secondsLeft > 0}>
        {t('invitation.submit', { ns: 'auth' })}
      </Button>
    </form>
  );
}

/**
 * Container de `/invitation`: muestra la vista previa (correo, rango, vigencia) y pide nombre y
 * contraseña. El token y la contraseña no pasan por la caché de Query: solo por el estado del
 * componente y por el cuerpo de dos `POST`.
 */
export function InvitationPage({ token, onAccepted, footer }: InvitationPageProps) {
  const { t } = useTranslation('auth');
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [rejected, setRejected] = useState(false);
  const previewAction = useAsyncAction(authApi.previewInvitation);

  function load() {
    if (token === undefined) return;
    void previewAction.run(token).then((result) => {
      if (result.ok) setPreview(result.value);
      else if (
        result.error instanceof ApiError &&
        result.error.code === ErrorCode.INVITATION_INVALID
      )
        setRejected(true);
    });
  }

  // Un solo arranque (StrictMode ejecuta los efectos dos veces en desarrollo).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` solo se llama una vez, aquí.
  }, []);

  if (token === undefined || rejected) {
    return (
      <AuthCard title={t('invitation.invalid.title')}>
        <Alert tone="danger">
          {token === undefined
            ? t('invitation.missingToken')
            : t('INVITATION.INVALID', { ns: 'errors' })}
        </Alert>
        {footer}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('invitation.title')}>
      {preview === null && previewAction.error === undefined ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner label={t('invitation.loading')} />
          <span aria-hidden="true">{t('invitation.loading')}</span>
        </div>
      ) : null}
      {previewAction.error !== undefined && preview === null ? (
        <ErrorAlert error={previewAction.error} onRetry={load} />
      ) : null}
      {preview !== null ? (
        <AcceptForm
          token={token}
          preview={preview}
          onAccepted={onAccepted}
          onInvalid={() => {
            setRejected(true);
          }}
        />
      ) : null}
      {footer}
    </AuthCard>
  );
}
