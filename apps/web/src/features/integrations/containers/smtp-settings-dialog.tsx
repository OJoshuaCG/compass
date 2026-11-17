import type { SmtpSettings } from '@iam/contracts';
import { SMTP_SECURITY_VALUES } from '@iam/contracts';
import { Button, Dialog, FormField, Input, NativeSelect, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createSmtpSettings, updateSmtpSettings } from '../api/integrations-api';
import {
  DEFAULT_SMTP_PORT,
  DEFAULT_SMTP_SECURITY,
  createSmtpFormSchema,
  editSmtpFormSchema,
  type SmtpFormValues,
} from '../model/smtp-settings-model';

type SmtpFormProps = {
  /** Sin servidor vigente se da de alta uno (con contraseña); con servidor se edita sin contraseña. */
  settings: SmtpSettings | undefined;
  onCancel: () => void;
  onSaved: () => void;
};

/**
 * La contraseña vive solo en el estado de este formulario: se envía con `useAsyncAction` (nunca con
 * Query), no se precarga (la API no la devuelve) y se descarta al cerrar porque el formulario se
 * desmonta con el diálogo (docs/frontend.md §17, regla 7).
 */
function SmtpForm({ settings, onCancel, onSaved }: SmtpFormProps) {
  const { t } = useTranslation(['integrations', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const isCreating = settings === undefined;
  const action = useAsyncAction(async (values: SmtpFormValues) => {
    if (settings === undefined) {
      const parsed = createSmtpFormSchema.parse(values);
      return createSmtpSettings({ ...parsed, port: Number(parsed.port) });
    }
    const parsed = editSmtpFormSchema.parse(values);
    return updateSmtpSettings(settings.id, {
      name: parsed.name,
      host: parsed.host,
      port: Number(parsed.port),
      security: parsed.security,
      username: parsed.username,
      fromAddress: parsed.fromAddress,
    });
  });
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<SmtpFormValues>({
    resolver: zodResolver(isCreating ? createSmtpFormSchema : editSmtpFormSchema),
    defaultValues: {
      name: settings?.name ?? '',
      host: settings?.host ?? '',
      port: settings === undefined ? DEFAULT_SMTP_PORT : String(settings.port),
      security: settings?.security ?? DEFAULT_SMTP_SECURITY,
      username: settings?.username ?? '',
      fromAddress: settings?.fromAddress ?? '',
      password: '',
    },
  });
  const name = useWatch({ control, name: 'name' });
  const host = useWatch({ control, name: 'host' });
  const port = useWatch({ control, name: 'port' });
  const username = useWatch({ control, name: 'username' });
  const fromAddress = useWatch({ control, name: 'fromAddress' });
  const password = useWatch({ control, name: 'password' });

  async function submit(values: SmtpFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onSaved();
      return;
    }
    // CHANNEL_ALREADY_ACTIVE, ARCHIVED, 403, 429 y 5xx se muestran en el aviso del diálogo.
    const knownFields = isCreating
      ? (['name', 'host', 'port', 'security', 'username', 'fromAddress', 'password'] as const)
      : (['name', 'host', 'port', 'security', 'username', 'fromAddress'] as const);
    if (
      applyFieldErrors(
        result.error,
        setError,
        knownFields,
        t('VALIDATION.FAILED', { ns: 'errors' }),
      )
    ) {
      action.reset();
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
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      <FormField
        label={t('smtp.form.name', { ns: 'integrations' })}
        help={t('smtp.form.nameHelp', { ns: 'integrations' })}
        required
        error={validationMessage(errors.name, { field: 'name', empty: name.trim() === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('name')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('smtp.form.host', { ns: 'integrations' })}
        help={t('smtp.form.hostHelp', { ns: 'integrations' })}
        required
        error={validationMessage(errors.host, { field: 'host', empty: host.trim() === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('host')}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            className="font-mono"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={t('smtp.form.port', { ns: 'integrations' })}
          required
          error={validationMessage(errors.port, { field: 'port', empty: port.trim() === '' })}
        >
          {(field) => (
            <Input
              {...field}
              {...register('port')}
              autoComplete="off"
              inputMode="numeric"
              className="font-mono"
              invalid={field['aria-invalid'] === true}
            />
          )}
        </FormField>
        <FormField
          label={t('smtp.form.security', { ns: 'integrations' })}
          help={t('smtp.form.securityHelp', { ns: 'integrations' })}
          required
          error={validationMessage(errors.security, { field: 'security' })}
        >
          {(field) => (
            <NativeSelect
              {...field}
              {...register('security')}
              invalid={field['aria-invalid'] === true}
            >
              {SMTP_SECURITY_VALUES.map((security) => (
                <option key={security} value={security}>
                  {t(`smtp.security.${security}`, { ns: 'integrations' })}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField
        label={t('smtp.form.username', { ns: 'integrations' })}
        required
        error={validationMessage(errors.username, {
          field: 'username',
          empty: username.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('username')}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('smtp.form.fromAddress', { ns: 'integrations' })}
        help={t('smtp.form.fromAddressHelp', { ns: 'integrations' })}
        required
        error={validationMessage(errors.fromAddress, {
          field: 'fromAddress',
          empty: fromAddress.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('fromAddress')}
            type="email"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {isCreating ? (
        <FormField
          label={t('smtp.form.password', { ns: 'integrations' })}
          help={t('smtp.form.passwordHelp', { ns: 'integrations' })}
          required
          error={validationMessage(errors.password, {
            field: 'smtpPassword',
            empty: password === '',
          })}
        >
          {(field) => (
            <PasswordInput
              {...field}
              {...register('password')}
              // `new-password` evita que el gestor del navegador ofrezca la contraseña de la persona.
              autoComplete="new-password"
              spellCheck={false}
              showLabel={t('password.show', { ns: 'common' })}
              hideLabel={t('password.hide', { ns: 'common' })}
              invalid={field['aria-invalid'] === true}
            />
          )}
        </FormField>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {isCreating
            ? t('smtp.create.submit', { ns: 'integrations' })
            : t('smtp.edit.submit', { ns: 'integrations' })}
        </Button>
      </div>
    </form>
  );
}

export type SmtpSettingsDialogProps = {
  settings: SmtpSettings | undefined;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el servidor. */
  onSaved: () => void;
};

/** Diálogo para dar de alta o editar el servidor SMTP. Lo monta el padre solo mientras está abierto. */
export function SmtpSettingsDialog({ settings, onClose, onSaved }: SmtpSettingsDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const isCreating = settings === undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        isCreating
          ? t('smtp.create.title', { ns: 'integrations' })
          : t('smtp.edit.title', { ns: 'integrations' })
      }
      description={
        isCreating
          ? t('smtp.create.description', { ns: 'integrations' })
          : t('smtp.edit.description', { ns: 'integrations' })
      }
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <SmtpForm settings={settings} onCancel={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
