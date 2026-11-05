import { ErrorCode, firstSetupRequestSchema, type FirstSetupResponse } from '@iam/contracts';
import { Alert, Button, FormField, Input, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { authApi } from '../api/auth-api';
import { AuthCard } from '../ui/auth-card';
import { PasswordStrength } from '../ui/password-strength';
import { RecoveryCodesPanel } from '../ui/recovery-codes-panel';

/** Causas por las que la política rechaza la contraseña; cada una tiene su mensaje en `errors`. */
const PASSWORD_POLICY_ERROR_CODES: readonly string[] = [
  ErrorCode.PASSWORD_WEAK,
  ErrorCode.PASSWORD_TOO_SHORT,
  ErrorCode.PASSWORD_TOO_LONG,
  ErrorCode.PASSWORD_CONTAINS_PERSONAL_DATA,
];

const FORM_FIELDS = [
  'organizationName',
  'organizationSlug',
  'rootEmail',
  'rootDisplayName',
  'password',
] as const;

const setupFormSchema = firstSetupRequestSchema.pick({
  organizationName: true,
  organizationSlug: true,
  rootEmail: true,
  rootDisplayName: true,
  password: true,
});
type Values = {
  organizationName: string;
  organizationSlug: string;
  rootEmail: string;
  rootDisplayName: string;
  password: string;
};

export type FirstSetupPageProps = {
  /** Token del enlace, ya extraído del fragmento por la ruta (que además lo borra de la URL). */
  token: string | undefined;
  /** Enlace a `/login` (lo arma la ruta). */
  footer?: ReactNode;
};

/**
 * Los códigos se entregan a dos custodios distintos (ADR 0037): cada línea lleva la letra del
 * suyo para que el papel impreso se pueda repartir sin volver a esta pantalla.
 */
function formatCodesForPrinting(codes: FirstSetupResponse['emergencyCodes']): string[] {
  return codes.map(({ code, custodyGroup }) => `${custodyGroup}: ${code}`);
}

type SetupFormProps = {
  token: string;
  onCompleted: (response: FirstSetupResponse) => void;
  onClosed: () => void;
};

function SetupForm({ token, onCompleted, onClosed }: SetupFormProps) {
  const { t } = useTranslation(['auth', 'errors', 'common']);
  const validationMessage = useValidationMessage();
  const setup = useAsyncAction(authApi.completeFirstSetup);
  const cooldown = useRateLimitCooldown(setup.error);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: {
      organizationName: '',
      organizationSlug: '',
      rootEmail: '',
      rootDisplayName: '',
      password: '',
    },
  });
  const [organizationName, organizationSlug, rootEmail, rootDisplayName, password] = useWatch({
    control,
    name: FORM_FIELDS,
  });

  async function submit(values: Values) {
    const result = await setup.run({ token, ...values });
    if (result.ok) {
      onCompleted(result.value);
      return;
    }
    const { error } = result;
    if (!(error instanceof ApiError)) return;
    if (error.code === ErrorCode.NOT_FOUND) {
      // Enlace equivocado o configuración ya hecha: el servidor responde igual en ambos casos.
      onClosed();
      return;
    }
    if (PASSWORD_POLICY_ERROR_CODES.includes(error.code)) {
      setError('password', { type: 'server', message: t(error.code, { ns: 'errors' }) });
      setup.reset();
      return;
    }
    if (applyFieldErrors(error, setError, FORM_FIELDS, t('VALIDATION.FAILED', { ns: 'errors' }))) {
      setup.reset();
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
      {setup.error !== undefined ? (
        <ErrorAlert error={setup.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('setup.organizationName', { ns: 'auth' })}
        required
        error={validationMessage(errors.organizationName, {
          field: 'organizationName',
          empty: organizationName.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('organizationName')}
            autoComplete="organization"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('setup.organizationSlug', { ns: 'auth' })}
        help={t('setup.organizationSlugHelp', { ns: 'auth' })}
        required
        error={validationMessage(errors.organizationSlug, {
          field: 'organizationSlug',
          empty: organizationSlug.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('organizationSlug')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('setup.rootDisplayName', { ns: 'auth' })}
        required
        error={validationMessage(errors.rootDisplayName, {
          field: 'rootDisplayName',
          empty: rootDisplayName.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('rootDisplayName')}
            autoComplete="name"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('setup.rootEmail', { ns: 'auth' })}
        required
        error={validationMessage(errors.rootEmail, {
          field: 'rootEmail',
          empty: rootEmail.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('rootEmail')}
            type="email"
            autoComplete="email"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('setup.password', { ns: 'auth' })}
        help={t('setup.passwordHelp', { ns: 'auth' })}
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
      <Button type="submit" loading={setup.pending} disabled={cooldown.secondsLeft > 0}>
        {t('setup.submit', { ns: 'auth' })}
      </Button>
    </form>
  );
}

/**
 * Container de `/setup` (ADR 0046): crea la primera organización y su Raíz con el token del enlace.
 * El token, la contraseña y los códigos de emergencia no pasan por la caché de Query: solo por el
 * estado del componente. Al terminar, los códigos se ven una sola vez.
 */
export function FirstSetupPage({ token, footer }: FirstSetupPageProps) {
  const { t } = useTranslation('auth');
  const [completed, setCompleted] = useState<FirstSetupResponse | null>(null);
  const [closed, setClosed] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);

  if (token === undefined || closed) {
    return (
      <AuthCard title={t('setup.closed.title')}>
        <Alert tone="danger">
          {token === undefined ? t('setup.missingToken') : t('setup.closed.description')}
        </Alert>
        {footer}
      </AuthCard>
    );
  }

  if (completed !== null && !codesSaved) {
    return (
      <AuthCard title={t('setup.codes.title')}>
        <p className="text-sm text-text-secondary">{t('setup.codes.description')}</p>
        <RecoveryCodesPanel
          codes={formatCodesForPrinting(completed.emergencyCodes)}
          onContinue={() => {
            // Los códigos salen del estado: ya no se pueden volver a ver.
            setCompleted(null);
            setCodesSaved(true);
          }}
        />
      </AuthCard>
    );
  }

  if (codesSaved) {
    return (
      <AuthCard title={t('setup.done.title')}>
        <Alert tone="success">{t('setup.done.description')}</Alert>
        {footer}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('setup.title')}>
      <p className="text-sm text-text-secondary">{t('setup.description')}</p>
      <SetupForm
        token={token}
        onCompleted={setCompleted}
        onClosed={() => {
          setClosed(true);
        }}
      />
      {footer}
    </AuthCard>
  );
}
