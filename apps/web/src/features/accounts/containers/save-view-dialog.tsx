import {
  createSavedAccountViewRequestSchema,
  ErrorCode,
  SAVED_VIEW_NAME_MAX_LENGTH,
  type AccountListFilter,
  type SavedAccountView,
} from '@iam/contracts';
import { Button, Dialog, FormField, Input } from '@iam/ui';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { createSavedView } from '../api/accounts-api';

export type SaveViewCriteria = {
  q: string | undefined;
  filter: AccountListFilter | undefined;
};

export type SaveViewDialogProps = {
  criteria: SaveViewCriteria;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa, recarga las vistas y selecciona la nueva. */
  onSaved: (view: SavedAccountView) => void;
};

const nameSchema = createSavedAccountViewRequestSchema.shape.name;

/** Diálogo «Guardar vista»: pide el nombre y guarda el texto y el filtro aplicados. */
export function SaveViewDialog({ criteria, onClose, onSaved }: SaveViewDialogProps) {
  const { t } = useTranslation(['accounts', 'common', 'errors']);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const action = useAsyncAction(createSavedView);
  const cooldown = useRateLimitCooldown(action.error);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (cooldown.secondsLeft > 0) return;
    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) {
      const isEmpty = name.trim() === '';
      setNameError(
        isEmpty
          ? t('validation.required', { ns: 'common' })
          : t('validation.tooLong', { ns: 'common' }),
      );
      return;
    }
    setNameError(undefined);
    const result = await action.run({
      name: parsedName.data,
      ...(criteria.q === undefined ? {} : { q: criteria.q }),
      ...(criteria.filter === undefined ? {} : { filter: criteria.filter }),
    });
    if (result.ok) {
      onSaved(result.value);
      return;
    }
    if (result.error instanceof ApiError && result.error.code === ErrorCode.SAVED_VIEW_NAME_TAKEN) {
      // Se muestra junto al campo: es lo único que la persona debe corregir.
      setNameError(t('SAVED_VIEW.NAME_TAKEN', { ns: 'errors' }));
      action.reset();
    }
    // El límite, 429 y 5xx se muestran en el aviso del diálogo (`action.error`).
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('views.saveTitle', { ns: 'accounts' })}
      description={t('views.saveDescription', { ns: 'accounts' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="flex flex-col gap-4"
      >
        {action.error !== undefined ? (
          <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
        ) : null}
        <FormField label={t('views.name', { ns: 'accounts' })} required error={nameError}>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={SAVED_VIEW_NAME_MAX_LENGTH}
              autoComplete="off"
              invalid={field['aria-invalid'] === true}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(undefined);
              }}
            />
          )}
        </FormField>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
            {t('views.saveSubmit', { ns: 'accounts' })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
