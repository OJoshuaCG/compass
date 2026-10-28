import { ErrorCode } from '@iam/contracts';
import { Button, Dialog, FormField, Input, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { accountsKeys, createAccount } from '../api/accounts-api';
import { accountFormSchema, buildCreateBody, type AccountFormValues } from '../model/account-form';

import { usePlatforms } from './use-platforms';

type CreateAccountFormProps = {
  onCancel: () => void;
  onCreated: (displayName: string) => void;
};

function CreateAccountForm({ onCancel, onCreated }: CreateAccountFormProps) {
  const { t } = useTranslation(['accounts', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const queryClient = useQueryClient();
  const platformsQuery = usePlatforms();
  const platforms = platformsQuery.data ?? [];
  const action = useAsyncAction((values: AccountFormValues) =>
    createAccount(buildCreateBody(values)),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { platformId: '', displayName: '', handle: '', tags: '' },
  });
  const platformId = useWatch({ control, name: 'platformId' });
  const displayName = useWatch({ control, name: 'displayName' });

  async function submit(values: AccountFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(result.value.displayName);
      return;
    }
    const { error } = result;
    if (error instanceof ApiError && error.code === ErrorCode.ACCOUNT_PLATFORM_INVALID) {
      // La plataforma pudo archivarse o retirarse desde que se cargó el catálogo: se recarga la lista.
      setError('platformId', {
        type: 'server',
        message: t('ACCOUNT.PLATFORM_INVALID', { ns: 'errors' }),
      });
      void queryClient.invalidateQueries({ queryKey: accountsKeys.platforms() });
      action.reset();
      return;
    }
    // 403, 409, 429 y 5xx se muestran en el aviso del diálogo (`action.error`).
    const knownFields = ['platformId', 'displayName', 'handle', 'tags'] as const;
    if (applyFieldErrors(error, setError, knownFields, t('VALIDATION.FAILED', { ns: 'errors' }))) {
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
      {platformsQuery.isError ? (
        <ErrorAlert
          error={platformsQuery.error}
          onRetry={() => {
            void platformsQuery.refetch();
          }}
        />
      ) : null}
      <FormField
        label={t('create.platform', { ns: 'accounts' })}
        required
        error={validationMessage(errors.platformId, {
          field: 'platformId',
          empty: platformId === '',
        })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('platformId')}
            invalid={field['aria-invalid'] === true}
          >
            <option value="">{t('create.platformPlaceholder', { ns: 'accounts' })}</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
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
          {t('create.submit', { ns: 'accounts' })}
        </Button>
      </div>
    </form>
  );
}

export type CreateAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre de la cuenta creada; el padre avisa y recarga. */
  onCreated: (displayName: string) => void;
};

/** Diálogo "Crear cuenta": plataforma, nombre, identificador y etiquetas. */
export function CreateAccountDialog({ open, onOpenChange, onCreated }: CreateAccountDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title', { ns: 'accounts' })}
      description={t('create.description', { ns: 'accounts' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      <CreateAccountForm
        onCancel={() => {
          onOpenChange(false);
        }}
        onCreated={onCreated}
      />
    </Dialog>
  );
}
