import type { InboundConfigurableView, InboundTemplateSummary } from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { updateInboundView } from '../api/inbound-api';
import {
  buildEditInboundViewFormSchema,
  buildUpdateViewBody,
  initialTemplateIds,
  type EditInboundViewFormValues,
} from '../model/inbound-view-model';
import { InboundTemplatePicker, useTemplatesErrorMessage } from '../ui/inbound-template-picker';

type EditInboundViewFormProps = {
  view: InboundConfigurableView;
  templates: readonly InboundTemplateSummary[];
  onCancel: () => void;
  /** Sin cambios: no se envía nada y el padre solo cierra el diálogo. */
  onUnchanged: () => void;
  onSaved: (name: string) => void;
};

function EditInboundViewForm({
  view,
  templates,
  onCancel,
  onUnchanged,
  onSaved,
}: EditInboundViewFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const templatesErrorMessage = useTemplatesErrorMessage();
  const templatesAvailable = templates.length > 0;
  const schema = useMemo(
    () => buildEditInboundViewFormSchema(templatesAvailable),
    [templatesAvailable],
  );
  const initialIds = useMemo(
    () =>
      initialTemplateIds(
        view,
        templates.map((template) => template.id),
      ),
    [view, templates],
  );
  const action = useAsyncAction((values: EditInboundViewFormValues) => {
    const parsed = schema.parse(values);
    const body = buildUpdateViewBody(view, initialIds, parsed);
    // `submit` ya descartó el caso sin cambios; este cuerpo nunca es nulo al llegar aquí.
    if (body === null) throw new Error('Nothing to update');
    return updateInboundView(view.id, body);
  });
  const cooldown = useRateLimitCooldown(action.error);

  const {
    handleSubmit,
    register,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitted },
  } = useForm<EditInboundViewFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: view.name, templateIds: initialIds },
  });
  const name = useWatch({ control, name: 'name' });
  const templateIds = useWatch({ control, name: 'templateIds' });

  async function submit(values: EditInboundViewFormValues) {
    const parsed = schema.parse(values);
    if (buildUpdateViewBody(view, initialIds, parsed) === null) {
      onUnchanged();
      return;
    }
    const result = await action.run(values);
    if (result.ok) {
      onSaved(result.value.name);
      return;
    }
    // INBOUND.VIEW_NAME_TAKEN, INBOUND.TEMPLATE_INVALID, AUTHZ.SHARE, 404, 429 y 5xx se muestran en
    // el aviso del diálogo; solo el 422 por campo se pinta en su campo.
    const knownFields = ['name', 'templateIds'] as const;
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
      {templatesAvailable ? (
        <InboundTemplatePicker
          templates={templates}
          selected={templateIds}
          error={templatesErrorMessage(errors.templateIds)}
          onChange={(next) => {
            setValue('templateIds', next, { shouldValidate: isSubmitted });
          }}
        />
      ) : (
        <p className="text-sm text-text-secondary">
          {t('viewSettings.form.templatesUnavailable', { ns: 'inbound' })}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('viewSettings.edit.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

export type EditInboundViewDialogProps = {
  view: InboundConfigurableView;
  templates: readonly InboundTemplateSummary[];
  onClose: () => void;
  /** Éxito: recibe el nombre guardado; el padre avisa y recarga. */
  onSaved: (name: string) => void;
};

/** Diálogo "Editar vista": nombre y plantillas; solo se envía lo que cambió. */
export function EditInboundViewDialog({
  view,
  templates,
  onClose,
  onSaved,
}: EditInboundViewDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewSettings.edit.title', { ns: 'inbound', name: view.name })}
      description={t('viewSettings.edit.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <EditInboundViewForm
        view={view}
        templates={templates}
        onCancel={onClose}
        onUnchanged={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  );
}
