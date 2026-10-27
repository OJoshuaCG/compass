import { registerPasskeyRequestSchema } from '@iam/contracts';
import { Alert, Button, Dialog, FormField, Input } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { registerPasskey, type RegisterPasskeyResult } from '../api/register-passkey';

// El formulario solo pide el nombre; la respuesta del navegador la aporta la ceremonia.
const nameFormSchema = z.object({ name: registerPasskeyRequestSchema.shape.name });
type Values = z.infer<typeof nameFormSchema>;

type AddPasskeyFormProps = {
  onCancel: () => void;
  onAdded: (name: string) => void;
};

/** Mensaje de un resultado que deja el diálogo abierto (cancelación, límite, ya registrada). */
const NOTICE_KEY = {
  cancelled: 'add.cancelled',
  limit: 'add.limit',
  alreadyRegistered: 'add.alreadyRegistered',
} as const satisfies Record<Exclude<RegisterPasskeyResult['kind'], 'registered'>, string>;

function AddPasskeyForm({ onCancel, onAdded }: AddPasskeyFormProps) {
  const { t } = useTranslation(['security', 'common']);
  const validationMessage = useValidationMessage();
  // El resultado de la ceremonia se queda en el estado del diálogo, nunca en la caché de Query.
  const action = useAsyncAction((name: string) => registerPasskey(name));
  const cooldown = useRateLimitCooldown(action.error);
  const [notice, setNotice] = useState<keyof typeof NOTICE_KEY | undefined>(undefined);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(nameFormSchema),
    defaultValues: { name: '' },
  });
  const name = useWatch({ control, name: 'name' });

  async function submit(values: Values) {
    setNotice(undefined);
    const result = await action.run(values.name);
    if (!result.ok) return;
    if (result.value.kind === 'registered') onAdded(result.value.name);
    else setNotice(result.value.kind);
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(submit)(event);
      }}
      className="flex flex-col gap-4"
    >
      {action.error instanceof ApiError ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : action.error !== undefined ? (
        // Fallo del navegador o del autenticador (no de la API): no hay código que traducir.
        <Alert tone="danger">{t('add.failed', { ns: 'security' })}</Alert>
      ) : null}
      {notice !== undefined ? (
        <Alert tone={notice === 'cancelled' ? 'info' : 'warning'}>
          {t(NOTICE_KEY[notice], { ns: 'security' })}
        </Alert>
      ) : null}
      <FormField
        label={t('add.name', { ns: 'security' })}
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
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('add.submit', { ns: 'security' })}
        </Button>
      </div>
    </form>
  );
}

export type AddPasskeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre; el padre avisa y recarga la lista. */
  onAdded: (name: string) => void;
};

/** Diálogo "Agregar passkey": nombre y ceremonia de registro del navegador. */
export function AddPasskeyDialog({ open, onOpenChange, onAdded }: AddPasskeyDialogProps) {
  const { t } = useTranslation(['security', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('add.title', { ns: 'security' })}
      description={t('add.description', { ns: 'security' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta su estado. */}
      <AddPasskeyForm
        onCancel={() => {
          onOpenChange(false);
        }}
        onAdded={onAdded}
      />
    </Dialog>
  );
}
