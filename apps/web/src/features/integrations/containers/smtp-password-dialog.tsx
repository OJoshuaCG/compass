import type { SmtpSettings } from '@iam/contracts';
import { Button, Dialog, FormField, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { rotateSmtpPassword } from '../api/integrations-api';
import {
  rotateSmtpPasswordFormSchema,
  type RotateSmtpPasswordFormValues,
} from '../model/smtp-settings-model';

type PasswordFormProps = {
  settings: SmtpSettings;
  onCancel: () => void;
  onSaved: () => void;
};

/** La contraseña nueva vive solo en el estado de este formulario y se descarta al cerrar el diálogo. */
function PasswordForm({ settings, onCancel, onSaved }: PasswordFormProps) {
  const { t } = useTranslation(['integrations', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: RotateSmtpPasswordFormValues) =>
    rotateSmtpPassword(settings.id, rotateSmtpPasswordFormSchema.parse(values).password),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RotateSmtpPasswordFormValues>({
    resolver: zodResolver(rotateSmtpPasswordFormSchema),
    defaultValues: { password: '' },
  });
  const password = useWatch({ control, name: 'password' });

  async function submit(values: RotateSmtpPasswordFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onSaved();
      return;
    }
    if (
      applyFieldErrors(
        result.error,
        setError,
        ['password'] as const,
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
            autoComplete="new-password"
            spellCheck={false}
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('smtp.password.submit', { ns: 'integrations' })}
        </Button>
      </div>
    </form>
  );
}

export type SmtpPasswordDialogProps = {
  settings: SmtpSettings;
  onClose: () => void;
  onSaved: () => void;
};

/** Diálogo «Cambiar contraseña SMTP». La guardada nunca se muestra: solo se reemplaza. */
export function SmtpPasswordDialog({ settings, onClose, onSaved }: SmtpPasswordDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('smtp.password.title', { ns: 'integrations' })}
      description={t('smtp.password.description', { ns: 'integrations' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <PasswordForm settings={settings} onCancel={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
