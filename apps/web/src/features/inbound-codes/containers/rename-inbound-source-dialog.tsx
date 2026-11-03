import type { InboundSourceSummary } from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { renameInboundSource } from '../api/inbound-api';
import {
  renameInboundSourceFormSchema,
  type RenameInboundSourceFormValues,
} from '../model/inbound-source-model';

type RenameInboundSourceFormProps = {
  source: InboundSourceSummary;
  onCancel: () => void;
  onRenamed: (displayName: string) => void;
};

function RenameInboundSourceForm({ source, onCancel, onRenamed }: RenameInboundSourceFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: RenameInboundSourceFormValues) =>
    renameInboundSource(source.id, renameInboundSourceFormSchema.parse(values).displayName),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RenameInboundSourceFormValues>({
    resolver: zodResolver(renameInboundSourceFormSchema),
    defaultValues: { displayName: source.displayName },
  });
  const displayName = useWatch({ control, name: 'displayName' });

  async function submit(values: RenameInboundSourceFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onRenamed(result.value.displayName);
      return;
    }
    // NOT_FOUND, AUTHZ.SHARE, 429 y 5xx se muestran en el aviso del diálogo.
    const knownFields = ['displayName'] as const;
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
          {t('sources.rename.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

export type RenameInboundSourceDialogProps = {
  source: InboundSourceSummary;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga. */
  onRenamed: (displayName: string) => void;
};

/** Diálogo "Renombrar fuente": solo el nombre; la dirección no cambia. */
export function RenameInboundSourceDialog({
  source,
  onClose,
  onRenamed,
}: RenameInboundSourceDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('sources.rename.title', { ns: 'inbound', name: source.displayName })}
      description={t('sources.rename.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <RenameInboundSourceForm source={source} onCancel={onClose} onRenamed={onRenamed} />
    </Dialog>
  );
}
