import { ErrorCode, GROUP_DESCRIPTION_MAX_LENGTH, createGroupRequestSchema } from '@iam/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import {
  ApiError,
  applyFieldErrors,
  useAsyncAction,
  useRateLimitCooldown,
} from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createGroup } from '../api/groups-api';
import { toCreateGroupRequest } from '../model/groups-model';

type FormInput = z.input<typeof createGroupRequestSchema>;

type CreateGroupFormProps = {
  onCancel: () => void;
  onCreated: (name: string) => void;
};

function CreateGroupForm({ onCancel, onCreated }: CreateGroupFormProps) {
  const { t } = useTranslation(['directory', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: FormInput) => createGroup(toCreateGroupRequest(values)));
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<FormInput, unknown, z.output<typeof createGroupRequestSchema>>({
    resolver: zodResolver(createGroupRequestSchema),
    defaultValues: { name: '', description: '' },
  });
  const name = useWatch({ control, name: 'name' });

  async function submit(values: FormInput) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(values.name.trim());
      return;
    }
    const { error } = result;
    if (error instanceof ApiError && error.code === ErrorCode.GROUP_NAME_TAKEN) {
      setError('name', { type: 'server', message: t('GROUP.NAME_TAKEN', { ns: 'errors' }) });
      action.reset();
      return;
    }
    if (
      applyFieldErrors(
        error,
        setError,
        ['name', 'description'],
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
        label={t('groups.create.name')}
        required
        error={validationMessage(errors.name, { field: 'name', empty: name === '' })}
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
        label={t('groups.create.descriptionLabel')}
        help={t('groups.create.descriptionHelp')}
        error={validationMessage(errors.description, { field: 'description', empty: false })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('description')}
            autoComplete="off"
            maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('groups.create.submit')}
        </Button>
      </div>
    </form>
  );
}

export type CreateGroupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre del grupo creado; el padre avisa y recarga. */
  onCreated: (name: string) => void;
};

/** Diálogo «Crear grupo»: nombre y descripción opcional; quien lo crea queda como gestor. */
export function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('groups.create.title')}
      description={t('groups.create.description')}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      <CreateGroupForm
        onCancel={() => {
          onOpenChange(false);
        }}
        onCreated={onCreated}
      />
    </Dialog>
  );
}
