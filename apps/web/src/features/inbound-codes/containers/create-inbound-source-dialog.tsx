import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createInboundSource } from '../api/inbound-api';
import {
  buildCreateSourceBody,
  createInboundSourceFormSchema,
  type CreateInboundSourceFormValues,
} from '../model/inbound-source-model';

type CreateInboundSourceFormProps = {
  onCancel: () => void;
  onCreated: (displayName: string) => void;
};

function CreateInboundSourceForm({ onCancel, onCreated }: CreateInboundSourceFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: CreateInboundSourceFormValues) =>
    createInboundSource(buildCreateSourceBody(createInboundSourceFormSchema.parse(values))),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<CreateInboundSourceFormValues>({
    resolver: zodResolver(createInboundSourceFormSchema),
    defaultValues: { address: '', displayName: '' },
  });
  const address = useWatch({ control, name: 'address' });
  const displayName = useWatch({ control, name: 'displayName' });

  async function submit(values: CreateInboundSourceFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(result.value.displayName);
      return;
    }
    // INBOUND.SOURCE_ADDRESS_TAKEN, 403, 429 y 5xx se muestran en el aviso del diálogo
    // (`action.error`), como en las cuentas; solo el 422 por campo se pinta en su campo.
    const knownFields = ['address', 'displayName'] as const;
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
        label={t('sources.form.address', { ns: 'inbound' })}
        help={t('sources.form.addressHelp', { ns: 'inbound' })}
        required
        error={validationMessage(errors.address, { field: 'email', empty: address.trim() === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('address')}
            type="email"
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('sources.form.name', { ns: 'inbound' })}
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
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('sources.create.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

export type CreateInboundSourceDialogProps = {
  onClose: () => void;
  /** Éxito: recibe el nombre de la fuente creada; el padre avisa y recarga. */
  onCreated: (displayName: string) => void;
};

/**
 * Diálogo "Agregar fuente": dirección de correo y nombre. El padre lo monta solo mientras está
 * abierto, igual que renombrar y archivar: al cerrarlo se descarta el estado del formulario.
 */
export function CreateInboundSourceDialog({ onClose, onCreated }: CreateInboundSourceDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('sources.create.title', { ns: 'inbound' })}
      description={t('sources.create.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <CreateInboundSourceForm onCancel={onClose} onCreated={onCreated} />
    </Dialog>
  );
}
