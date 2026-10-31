import { createCredentialRequestSchema, type CreateCredentialRequest } from '@iam/contracts';
import { Button, Dialog, FormField, Input, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createCredential } from '../api/credentials-api';

type CreateCredentialFormProps = {
  accountId: string;
  onCancel: () => void;
  onCreated: (label: string) => void;
};

function CreateCredentialForm({ accountId, onCancel, onCreated }: CreateCredentialFormProps) {
  const { t } = useTranslation(['credentials', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  // Sin `useMutation`: su caché conservaría la contraseña en `variables` (docs/frontend.md §9).
  const action = useAsyncAction((body: CreateCredentialRequest) =>
    createCredential(accountId, body),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<CreateCredentialRequest>({
    resolver: zodResolver(createCredentialRequestSchema),
    defaultValues: { label: '', username: '', password: '' },
  });
  const label = useWatch({ control, name: 'label' });
  const username = useWatch({ control, name: 'username' });
  const password = useWatch({ control, name: 'password' });

  async function submit(values: CreateCredentialRequest) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(result.value.label);
      return;
    }
    const knownFields = ['label', 'username', 'password'] as const;
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
        label={t('form.label', { ns: 'credentials' })}
        required
        error={validationMessage(errors.label, { field: 'label', empty: label.trim() === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('label')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('form.username', { ns: 'credentials' })}
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
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('form.password', { ns: 'credentials' })}
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
          {t('create.submit', { ns: 'credentials' })}
        </Button>
      </div>
    </form>
  );
}

export type CreateCredentialDialogProps = {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre de la credencial; el padre avisa y recarga. */
  onCreated: (label: string) => void;
};

/** Diálogo "Agregar credencial": nombre, usuario y contraseña. */
export function CreateCredentialDialog({
  accountId,
  open,
  onOpenChange,
  onCreated,
}: CreateCredentialDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title', { ns: 'credentials' })}
      description={t('create.description', { ns: 'credentials' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta la contraseña. */}
      <CreateCredentialForm
        accountId={accountId}
        onCancel={() => {
          onOpenChange(false);
        }}
        onCreated={onCreated}
      />
    </Dialog>
  );
}
