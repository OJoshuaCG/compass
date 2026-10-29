import {
  changeCredentialPasswordRequestSchema,
  type ChangeCredentialPasswordRequest,
  type Credential,
} from '@iam/contracts';
import { Button, Dialog, FormField, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { changeCredentialPassword } from '../api/credentials-api';

type ChangePasswordFormProps = {
  credential: Credential;
  onCancel: () => void;
  onChanged: () => void;
};

function ChangePasswordForm({ credential, onCancel, onChanged }: ChangePasswordFormProps) {
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((body: ChangeCredentialPasswordRequest) =>
    changeCredentialPassword(credential.id, body),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<ChangeCredentialPasswordRequest>({
    resolver: zodResolver(changeCredentialPasswordRequestSchema),
    defaultValues: { password: '' },
  });
  const password = useWatch({ control, name: 'password' });

  async function submit(values: ChangeCredentialPasswordRequest) {
    const result = await action.run(values);
    if (result.ok) {
      onChanged();
      return;
    }
    if (
      applyFieldErrors(
        result.error,
        setError,
        ['password'],
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
        label={t('form.newPassword', { ns: 'credentials' })}
        required
        error={validationMessage(errors.password, {
          field: 'credentialPassword',
          empty: password === '',
        })}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('password')}
            autoComplete="new-password"
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('password.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}

export type ChangePasswordDialogProps = {
  credential: Credential;
  onClose: () => void;
  /** Éxito: el padre cierra, avisa y recarga. */
  onChanged: () => void;
};

/** Diálogo "Cambiar contraseña": crea una versión nueva; la anterior queda en el historial. */
export function ChangePasswordDialog({
  credential,
  onClose,
  onChanged,
}: ChangePasswordDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('password.title', { ns: 'credentials', label: credential.label })}
      description={t('password.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <ChangePasswordForm credential={credential} onCancel={onClose} onChanged={onChanged} />
    </Dialog>
  );
}
