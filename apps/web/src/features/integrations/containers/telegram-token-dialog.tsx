import type { TelegramIntegration } from '@iam/contracts';
import { Button, Dialog, FormField, PasswordInput } from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import { rotateTelegramBotToken } from '../api/integrations-api';
import {
  rotateTelegramTokenFormSchema,
  type RotateTelegramTokenFormValues,
} from '../model/telegram-channel-model';

type TokenFormProps = {
  channel: TelegramIntegration;
  onCancel: () => void;
  onSaved: () => void;
};

/** El token nuevo vive solo en el estado de este formulario y se descarta al cerrar el diálogo. */
function TokenForm({ channel, onCancel, onSaved }: TokenFormProps) {
  const { t } = useTranslation(['integrations', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const action = useAsyncAction((values: RotateTelegramTokenFormValues) =>
    rotateTelegramBotToken(channel.id, rotateTelegramTokenFormSchema.parse(values).botToken),
  );
  const cooldown = useRateLimitCooldown(action.error);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RotateTelegramTokenFormValues>({
    resolver: zodResolver(rotateTelegramTokenFormSchema),
    defaultValues: { botToken: '' },
  });
  const botToken = useWatch({ control, name: 'botToken' });

  async function submit(values: RotateTelegramTokenFormValues) {
    const result = await action.run(values);
    if (result.ok) {
      onSaved();
      return;
    }
    if (
      applyFieldErrors(
        result.error,
        setError,
        ['botToken'] as const,
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
            autoComplete="new-password"
            spellCheck={false}
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('telegram.token.submit', { ns: 'integrations' })}
        </Button>
      </div>
    </form>
  );
}

export type TelegramTokenDialogProps = {
  channel: TelegramIntegration;
  onClose: () => void;
  onSaved: () => void;
};

/** Diálogo «Cambiar token del bot». El token guardado nunca se muestra: solo se reemplaza. */
export function TelegramTokenDialog({ channel, onClose, onSaved }: TelegramTokenDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('telegram.token.title', { ns: 'integrations' })}
      description={t('telegram.token.description', { ns: 'integrations' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <TokenForm channel={channel} onCancel={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
