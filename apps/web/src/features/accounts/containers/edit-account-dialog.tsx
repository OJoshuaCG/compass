import type { Account } from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { updateAccount } from '../api/accounts-api';
import {
  buildUpdateBody,
  editAccountFormSchema,
  isEmptyUpdate,
  tagsToText,
  type EditAccountFormValues,
} from '../model/account-form';

type EditAccountFormProps = {
  account: Account;
  onCancel: () => void;
  onUpdated: (displayName: string) => void;
  /** Descarta el diálogo y recarga la lista: la salida ante un conflicto (409). */
  onReload: () => void;
};

function EditAccountForm({ account, onCancel, onUpdated, onReload }: EditAccountFormProps) {
  const { t } = useTranslation(['accounts', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: EditAccountFormValues) => {
    const body = buildUpdateBody(account, values);
    return updateAccount(account.id, body);
  });
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<EditAccountFormValues>({
    resolver: zodResolver(editAccountFormSchema),
    defaultValues: {
      displayName: account.displayName,
      handle: account.handle ?? '',
      tags: tagsToText(account.tags),
    },
  });
  const displayName = useWatch({ control, name: 'displayName' });

  async function submit(values: EditAccountFormValues) {
    // Sin cambios no hay nada que guardar (el servidor rechazaría un cuerpo vacío): se cierra.
    if (isEmptyUpdate(buildUpdateBody(account, values))) {
      onCancel();
      return;
    }
    const result = await action.run(values);
    if (result.ok) {
      onUpdated(result.value.displayName);
      return;
    }
    // ACCOUNT.ARCHIVED, 403, 409, 429 y 5xx se muestran en el aviso del diálogo.
    const knownFields = ['displayName', 'handle', 'tags'] as const;
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

  const hasConflict = action.error instanceof ApiError && action.error.status === 409;

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
      {hasConflict ? (
        <div>
          <Button variant="secondary" size="sm" onClick={onReload}>
            {t('edit.reload', { ns: 'accounts' })}
          </Button>
        </div>
      ) : null}
      <FormField
        label={t('form.name', { ns: 'accounts' })}
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
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('form.handle', { ns: 'accounts' })}
        help={t('form.handleHelp', { ns: 'accounts' })}
        error={validationMessage(errors.handle, { field: 'handle' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('handle')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('form.tags', { ns: 'accounts' })}
        help={t('form.tagsHelp', { ns: 'accounts' })}
        error={validationMessage(errors.tags, { field: 'tags' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('tags')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('edit.submit', { ns: 'accounts' })}
        </Button>
      </div>
    </form>
  );
}

export type EditAccountDialogProps = {
  account: Account;
  onClose: () => void;
  /** Éxito: recibe el nombre ya guardado; el padre avisa y recarga. */
  onUpdated: (displayName: string) => void;
  onReload: () => void;
};

/** Diálogo "Editar cuenta": nombre, identificador y etiquetas; la plataforma no se cambia. */
export function EditAccountDialog({
  account,
  onClose,
  onUpdated,
  onReload,
}: EditAccountDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('edit.title', { ns: 'accounts', name: account.displayName })}
      description={t('edit.description', { ns: 'accounts' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <EditAccountForm
        account={account}
        onCancel={onClose}
        onUpdated={onUpdated}
        onReload={onReload}
      />
    </Dialog>
  );
}
