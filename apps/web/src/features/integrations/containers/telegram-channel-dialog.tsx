import type { TelegramIntegration } from '@iam/contracts';
import { Button, Dialog, FormField, Input, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { createTelegramIntegration, updateTelegramIntegration } from '../api/integrations-api';
import {
  TELEGRAM_INFRA_KIND,
  createTelegramChannelFormSchema,
  editTelegramChannelFormSchema,
  type CreateTelegramChannelFormValues,
} from '../model/telegram-channel-model';

type ChannelFormProps = {
  /** Sin canal vigente se da de alta uno (con token); con canal se editan solo nombre y chat. */
  channel: TelegramIntegration | undefined;
  onCancel: () => void;
  onSaved: () => void;
};

/**
 * El token vive solo en el estado de este formulario: se envía con `useAsyncAction` (nunca con Query),
 * no se precarga (la API no lo devuelve) y se descarta al cerrar porque el formulario se desmonta con
 * el diálogo (docs/frontend.md §17, regla 7).
 */
function ChannelForm({ channel, onCancel, onSaved }: ChannelFormProps) {
  const { t } = useTranslation(['integrations', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const isCreating = channel === undefined;
  const action = useAsyncAction(async (values: CreateTelegramChannelFormValues) => {
    if (channel === undefined) {
      const parsed = createTelegramChannelFormSchema.parse(values);
      return createTelegramIntegration({ kind: TELEGRAM_INFRA_KIND, ...parsed });
    }
    const parsed = editTelegramChannelFormSchema.parse(values);
    return updateTelegramIntegration(channel.id, { name: parsed.name, chatId: parsed.chatId });
  });
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<CreateTelegramChannelFormValues>({
    resolver: zodResolver(
      isCreating ? createTelegramChannelFormSchema : editTelegramChannelFormSchema,
    ),
    defaultValues: { name: channel?.name ?? '', chatId: channel?.chatId ?? '', botToken: '' },
  });
  const name = useWatch({ control, name: 'name' });
  const chatId = useWatch({ control, name: 'chatId' });
  const botToken = useWatch({ control, name: 'botToken' });

  async function submit(values: CreateTelegramChannelFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onSaved();
      return;
    }
    // CHANNEL_ALREADY_ACTIVE, ARCHIVED, 403, 429 y 5xx se muestran en el aviso del diálogo.
    const knownFields = isCreating
      ? (['name', 'chatId', 'botToken'] as const)
      : (['name', 'chatId'] as const);
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
        label={t('telegram.form.name', { ns: 'integrations' })}
        help={t('telegram.form.nameHelp', { ns: 'integrations' })}
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
      <FormField
        label={t('telegram.form.chatId', { ns: 'integrations' })}
        help={t('telegram.form.chatIdHelp', { ns: 'integrations' })}
        required
        error={validationMessage(errors.chatId, { field: 'chatId', empty: chatId.trim() === '' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('chatId')}
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            className="font-mono"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {isCreating ? (
        <FormField
          label={t('telegram.form.botToken', { ns: 'integrations' })}
          help={t('telegram.form.botTokenHelp', { ns: 'integrations' })}
          required
          error={validationMessage(errors.botToken, {
            field: 'botToken',
            empty: botToken.trim() === '',
          })}
        >
          {(field) => (
            <PasswordInput
              {...field}
              {...register('botToken')}
              // `new-password` evita que el gestor del navegador ofrezca la contraseña de la persona.
              autoComplete="new-password"
              spellCheck={false}
              showLabel={t('password.show', { ns: 'common' })}
              hideLabel={t('password.hide', { ns: 'common' })}
              invalid={field['aria-invalid'] === true}
            />
          )}
        </FormField>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {isCreating
            ? t('telegram.create.submit', { ns: 'integrations' })
            : t('telegram.edit.submit', { ns: 'integrations' })}
        </Button>
      </div>
    </form>
  );
}

export type TelegramChannelDialogProps = {
  channel: TelegramIntegration | undefined;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el canal. */
  onSaved: () => void;
};

/** Diálogo para dar de alta o editar el canal de Telegram. Lo monta el padre solo mientras está abierto. */
export function TelegramChannelDialog({ channel, onClose, onSaved }: TelegramChannelDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const isCreating = channel === undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        isCreating
          ? t('telegram.create.title', { ns: 'integrations' })
          : t('telegram.edit.title', { ns: 'integrations' })
      }
      description={
        isCreating
          ? t('telegram.create.description', { ns: 'integrations' })
          : t('telegram.edit.description', { ns: 'integrations' })
      }
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <ChannelForm channel={channel} onCancel={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
