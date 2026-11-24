import {
  registerOidcClientRequestSchema,
  type OidcClientWithSecret,
  type RegisterOidcClientRequest,
} from '@iam/contracts';
import { Button, FormField, Input, NativeSelect } from '@iam/ui';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { applyFieldErrors, type AsyncAction } from '../../../shared/api';
import { usePermission } from '../../../shared/auth';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import {
  CLIENT_RANK_CHOICES,
  EMPTY_REGISTER_CLIENT_FORM,
  MAX_URIS_PER_LIST,
  toRegisterRequest,
  type RegisterClientFormValues,
} from '../model/register-client-model';
import { CheckboxField } from '../ui/checkbox-field';
import { UriListField } from '../ui/uri-list-field';

type RegisterAction = AsyncAction<[RegisterOidcClientRequest], OidcClientWithSecret>;

/** Campos del formulario que admiten un error propio (los de la petición con el mismo nombre). */
const FORM_FIELDS = [
  'name',
  'redirectUris',
  'postLogoutRedirectUris',
  'backchannelLogoutUri',
  'refreshJustification',
  'maxRank',
] as const satisfies readonly (keyof RegisterClientFormValues)[];

type FormField = (typeof FORM_FIELDS)[number];

function isFormField(value: unknown): value is FormField {
  return FORM_FIELDS.some((field) => field === value);
}

export type RegisterClientFormProps = {
  action: RegisterAction;
  /** Segundos de espera tras un 429; deshabilitan el envío. */
  cooldownSeconds: number;
  onCancel: () => void;
  onRegistered: (result: OidcClientWithSecret) => void;
};

/**
 * Formulario «Registrar aplicación». Valida en el borde con el esquema del contrato, muestra cada
 * error junto a su campo y deja la validación fina de las direcciones al servidor, cuyos errores
 * por campo (422) se mapean a los mismos campos. El secreto de la respuesta sale por `onRegistered`
 * y no se guarda aquí.
 */
export function RegisterClientForm({
  action,
  cooldownSeconds,
  onCancel,
  onRegistered,
}: RegisterClientFormProps) {
  const { t } = useTranslation(['oidcClients', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  // Solo comodidad: el servidor exige `org.settings` para este campo y decide siempre.
  const canAllowPrivateNetwork = usePermission('org.settings');

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterClientFormValues>({ defaultValues: EMPTY_REGISTER_CLIENT_FORM });
  const hasBackchannelUri = useWatch({ control, name: 'backchannelLogoutUri' }).trim() !== '';

  async function submit(values: RegisterClientFormValues) {
    const parsed = registerOidcClientRequestSchema.safeParse(toRegisterRequest(values));
    if (!parsed.success) {
      // Un error por campo (el primero): las filas de una lista comparten el mensaje del grupo.
      const reported = new Set<FormField>();
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (!isFormField(field) || reported.has(field)) continue;
        reported.add(field);
        setError(field, { type: issue.code, message: issue.message });
      }
      return;
    }
    const result = await action.run(parsed.data);
    if (result.ok) {
      onRegistered(result.value);
      return;
    }
    if (
      applyFieldErrors(
        result.error,
        setError,
        FORM_FIELDS,
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
        <ErrorAlert error={action.error} secondsLeft={cooldownSeconds} />
      ) : null}
      <FormField
        label={t('form.name')}
        help={t('form.nameHelp')}
        required
        error={validationMessage(errors.name, { field: 'name' })}
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
      <Controller
        control={control}
        name="redirectUris"
        render={({ field }) => (
          <UriListField
            label={t('form.redirectUris')}
            help={t('form.redirectUrisHelp', { max: MAX_URIS_PER_LIST })}
            required
            error={validationMessage(errors.redirectUris, {
              field: 'redirectUris',
            })}
            values={field.value}
            onChange={field.onChange}
            max={MAX_URIS_PER_LIST}
          />
        )}
      />
      <Controller
        control={control}
        name="postLogoutRedirectUris"
        render={({ field }) => (
          <UriListField
            label={t('form.postLogoutRedirectUris')}
            help={t('form.postLogoutRedirectUrisHelp', { max: MAX_URIS_PER_LIST })}
            error={validationMessage(errors.postLogoutRedirectUris, {
              field: 'postLogoutRedirectUris',
            })}
            values={field.value}
            onChange={field.onChange}
            max={MAX_URIS_PER_LIST}
          />
        )}
      />
      <FormField
        label={t('form.backchannelLogoutUri')}
        help={t('form.backchannelLogoutUriHelp')}
        error={validationMessage(errors.backchannelLogoutUri, { field: 'backchannelLogoutUri' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('backchannelLogoutUri')}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {canAllowPrivateNetwork && hasBackchannelUri ? (
        <Controller
          control={control}
          name="allowPrivateNetworkBackchannel"
          render={({ field }) => (
            <CheckboxField
              label={t('form.allowPrivateNetworkBackchannel')}
              help={t('form.allowPrivateNetworkBackchannelHelp')}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      ) : null}
      <FormField
        label={t('form.refreshJustification')}
        help={t('form.refreshJustificationHelp')}
        error={validationMessage(errors.refreshJustification, { field: 'refreshJustification' })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('refreshJustification')}
            autoComplete="off"
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('form.maxRank')}
        help={t('form.maxRankHelp')}
        error={validationMessage(errors.maxRank, { field: 'maxRank' })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('maxRank')}
            invalid={field['aria-invalid'] === true}
            className="w-full"
          >
            <option value="">{t('form.maxRankAny')}</option>
            {CLIENT_RANK_CHOICES.map((rank) => (
              <option key={rank} value={String(rank)}>
                {t('maxRank.upTo', { rank: t(`rank.${String(rank)}`, { ns: 'common' }) })}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Controller
        control={control}
        name="isExternal"
        render={({ field }) => (
          <CheckboxField
            label={t('form.isExternal')}
            help={t('form.isExternalHelp')}
            checked={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled={action.pending} onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldownSeconds > 0}>
          {t('register.submit')}
        </Button>
      </div>
    </form>
  );
}
