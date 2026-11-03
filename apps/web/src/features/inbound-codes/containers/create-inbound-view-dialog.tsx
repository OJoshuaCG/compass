import type { InboundSourceSummary, InboundTemplateSummary } from '@iam/contracts';
import { Button, Dialog, FormField, Input, NativeSelect } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createInboundView } from '../api/inbound-api';
import {
  buildCreateViewBody,
  createInboundViewFormSchema,
  type CreateInboundViewFormValues,
} from '../model/inbound-view-model';
import { InboundTemplatePicker, useTemplatesErrorMessage } from '../ui/inbound-template-picker';

type CreateInboundViewFormProps = {
  sources: readonly InboundSourceSummary[];
  templates: readonly InboundTemplateSummary[];
  onCancel: () => void;
  onCreated: (name: string) => void;
};

function CreateInboundViewForm({
  sources,
  templates,
  onCancel,
  onCreated,
}: CreateInboundViewFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const templatesErrorMessage = useTemplatesErrorMessage();
  const action = useAsyncAction((values: CreateInboundViewFormValues) =>
    createInboundView(buildCreateViewBody(createInboundViewFormSchema.parse(values))),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<CreateInboundViewFormValues>({
    resolver: zodResolver(createInboundViewFormSchema),
    defaultValues: { sourceId: '', name: '', templateIds: [] },
  });
  const name = useWatch({ control, name: 'name' });
  const sourceId = useWatch({ control, name: 'sourceId' });
  const templateIds = useWatch({ control, name: 'templateIds' });
  const hasTemplates = templates.length > 0;

  async function submit(values: CreateInboundViewFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onCreated(result.value.name);
      return;
    }
    // INBOUND.VIEW_NAME_TAKEN, INBOUND.TEMPLATE_INVALID, AUTHZ.SHARE, 404, 429 y 5xx se muestran en
    // el aviso del diálogo (`action.error`); solo el 422 por campo se pinta en su campo.
    const knownFields = ['sourceId', 'name', 'templateIds'] as const;
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
        label={t('viewSettings.form.source', { ns: 'inbound' })}
        required
        error={validationMessage(errors.sourceId, { field: 'sourceId', empty: sourceId === '' })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('sourceId')}
            invalid={field['aria-invalid'] === true}
          >
            <option value="">{t('viewSettings.form.sourcePlaceholder', { ns: 'inbound' })}</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        label={t('viewSettings.form.name', { ns: 'inbound' })}
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
      <InboundTemplatePicker
        templates={templates}
        selected={templateIds}
        error={templatesErrorMessage(errors.templateIds)}
        onChange={(next) => {
          // Tras el primer envío se revalida al marcar, para que el aviso desaparezca en cuanto se corrige.
          setValue('templateIds', next, { shouldValidate: isSubmitted });
        }}
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          loading={action.pending}
          disabled={cooldown.secondsLeft > 0 || !hasTemplates}
        >
          {t('viewSettings.create.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

export type CreateInboundViewDialogProps = {
  /** Solo las fuentes donde la persona puede crear vistas (EDIT o MANAGE, no archivadas). */
  sources: readonly InboundSourceSummary[];
  templates: readonly InboundTemplateSummary[];
  onClose: () => void;
  /** Éxito: recibe el nombre de la vista creada; el padre avisa y recarga. */
  onCreated: (name: string) => void;
};

/**
 * Diálogo "Crear vista": fuente, nombre y plantillas. El padre lo monta solo mientras está
 * abierto: al cerrarlo se descarta el estado del formulario.
 */
export function CreateInboundViewDialog({
  sources,
  templates,
  onClose,
  onCreated,
}: CreateInboundViewDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewSettings.create.title', { ns: 'inbound' })}
      description={t('viewSettings.create.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <CreateInboundViewForm
        sources={sources}
        templates={templates}
        onCancel={onClose}
        onCreated={onCreated}
      />
    </Dialog>
  );
}
