import type { InboundSourceConnection, InboundSourceSummary } from '@iam/contracts';
import { MAIL_PORT_BY_TLS_MODE, MAIL_TLS_MODES } from '@iam/contracts';
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  NativeSelect,
  PasswordInput,
  Spinner,
} from '@iam/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert, useValidationMessage } from '../../../shared/i18n';
import {
  fetchInboundSourceConnection,
  inboundKeys,
  putInboundSourceConnection,
} from '../api/inbound-api';
import {
  buildConnectionRequest,
  canEditRecipients,
  connectionFormSchema,
  formFieldOfContractField,
  initialConnectionValues,
  willClearStoredPassword,
  type ConnectionFormValues,
} from '../model/inbound-connection-model';

/**
 * Pinta en su campo cada error 422 del servidor. Es `applyFieldErrors` con traducción de nombres: el
 * servidor señala campos del contrato (`acceptedRecipients`, `port`) que el formulario edita con otro
 * nombre o a través de otro campo. Devuelve si pintó alguno.
 */
function applyConnectionFieldErrors(
  error: unknown,
  setError: UseFormSetError<ConnectionFormValues>,
  message: string,
): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  let applied = false;
  for (const fieldError of error.fieldErrors) {
    const formField = formFieldOfContractField(fieldError.field);
    if (formField === undefined) continue;
    setError(formField, { type: 'server', message });
    applied = true;
  }
  return applied;
}

type ConnectionFormProps = {
  source: InboundSourceSummary;
  connection: InboundSourceConnection | null;
  onCancel: () => void;
  onSaved: () => void;
};

/**
 * Formulario de conexión IMAP. La contraseña vive solo en el estado de este formulario: se envía con
 * `useAsyncAction` (nunca con Query), no se precarga (la API no la devuelve) y se descarta al cerrar,
 * porque el formulario se desmonta con el diálogo.
 */
function ConnectionForm({ source, connection, onCancel, onSaved }: ConnectionFormProps) {
  const { t } = useTranslation(['inbound', 'common', 'errors']);
  const validationMessage = useValidationMessage();
  const recipientsEditable = canEditRecipients(source);
  const requestOptions = useMemo(
    () => ({ canEditRecipients: recipientsEditable }),
    [recipientsEditable],
  );
  const action = useAsyncAction((values: ConnectionFormValues) =>
    putInboundSourceConnection(source.id, buildConnectionRequest(values, requestOptions)),
  );
  const cooldown = useRateLimitCooldown(action.error);
  const resetAction = action.reset;
  // Cerrar el diálogo con el guardado en curso lo cancela: el resultado tardío se ignora y no avisa
  // éxito ni cierra otro diálogo que se haya abierto mientras tanto.
  useEffect(() => resetAction, [resetAction]);

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema(requestOptions)),
    defaultValues: initialConnectionValues(source, connection),
  });
  const values = useWatch({ control }) as ConnectionFormValues;
  const clearsPassword = willClearStoredPassword(values, connection);
  const hasStoredPassword = connection?.hasPassword === true;

  async function submit(submitted: ConnectionFormValues) {
    const result = await action.run(submitted);
    if (result.ok) {
      onSaved();
      return;
    }
    // AUTHZ.SHARE, NOT_FOUND, INBOUND.RECIPIENT_NOT_ALLOWED, 429 y 5xx se muestran en el aviso.
    if (
      applyConnectionFieldErrors(result.error, setError, t('VALIDATION.FAILED', { ns: 'errors' }))
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
        label={t('sources.connection.host', { ns: 'inbound' })}
        help={t('sources.connection.hostHelp', { ns: 'inbound' })}
        required
        error={validationMessage(errors.host, {
          field: 'host',
          empty: values.host.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('host')}
            autoComplete="off"
            spellCheck={false}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('sources.connection.tlsMode', { ns: 'inbound' })}
        help={t('sources.connection.tlsModeHelp', { ns: 'inbound' })}
        required
        error={validationMessage(errors.tlsMode, { field: 'tlsMode' })}
      >
        {(field) => (
          <NativeSelect
            {...field}
            {...register('tlsMode')}
            invalid={field['aria-invalid'] === true}
          >
            {MAIL_TLS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`sources.connection.tlsModeOption.${mode}`, {
                  ns: 'inbound',
                  port: MAIL_PORT_BY_TLS_MODE[mode],
                })}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        label={t('sources.connection.username', { ns: 'inbound' })}
        required
        error={validationMessage(errors.username, {
          field: 'username',
          empty: values.username.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('username')}
            autoComplete="off"
            spellCheck={false}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      <FormField
        label={t('sources.connection.authservId', { ns: 'inbound' })}
        help={t('sources.connection.authservIdHelp', { ns: 'inbound' })}
        required
        error={validationMessage(errors.authservId, {
          field: 'authservId',
          empty: values.authservId.trim() === '',
        })}
      >
        {(field) => (
          <Input
            {...field}
            {...register('authservId')}
            autoComplete="off"
            spellCheck={false}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {recipientsEditable ? (
        <FormField
          label={t('sources.connection.recipients', { ns: 'inbound' })}
          help={t('sources.connection.recipientsHelp', { ns: 'inbound' })}
          required
          error={validationMessage(errors.recipients, {
            field: 'recipients',
            empty: values.recipients.trim() === '',
          })}
        >
          {(field) => (
            <Input
              {...field}
              {...register('recipients')}
              autoComplete="off"
              spellCheck={false}
              invalid={field['aria-invalid'] === true}
            />
          )}
        </FormField>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text">
            {t('sources.connection.recipients', { ns: 'inbound' })}
          </span>
          <span className="text-text-secondary">{values.recipients}</span>
          <span className="text-text-secondary">
            {t('sources.connection.recipientsManageOnly', { ns: 'inbound' })}
          </span>
        </div>
      )}
      <FormField
        label={t('sources.connection.password', { ns: 'inbound' })}
        help={
          hasStoredPassword
            ? t('sources.connection.passwordKeep', { ns: 'inbound' })
            : t('sources.connection.passwordNone', { ns: 'inbound' })
        }
        error={validationMessage(errors.password, { field: 'mailboxPassword' })}
      >
        {(field) => (
          <PasswordInput
            {...field}
            {...register('password')}
            // `new-password` evita que el gestor del navegador ofrezca la contraseña de la persona.
            autoComplete="new-password"
            showLabel={t('password.show', { ns: 'common' })}
            hideLabel={t('password.hide', { ns: 'common' })}
            invalid={field['aria-invalid'] === true}
          />
        )}
      </FormField>
      {clearsPassword ? (
        <Alert tone="warning">{t('sources.connection.clearsPassword', { ns: 'inbound' })}</Alert>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('actions.cancel', { ns: 'common' })}
        </Button>
        <Button type="submit" loading={action.pending} disabled={cooldown.secondsLeft > 0}>
          {t('sources.connection.submit', { ns: 'inbound' })}
        </Button>
      </div>
    </form>
  );
}

export type InboundSourceConnectionDialogProps = {
  source: InboundSourceSummary;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo y avisa. */
  onSaved: () => void;
};

/**
 * Diálogo "Conexión del buzón": servidor IMAP, usuario, `authserv-id`, destinatarios aceptados y
 * contraseña. Lo monta el padre solo mientras está abierto. La conexión guardada (sin contraseña) se
 * pide al abrir, sin reutilizar caché, porque otra persona pudo cambiarla.
 */
export function InboundSourceConnectionDialog({
  source,
  onClose,
  onSaved,
}: InboundSourceConnectionDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const query = useQuery({
    queryKey: inboundKeys.connection(source.id),
    queryFn: ({ signal }) => fetchInboundSourceConnection(source.id, signal),
    staleTime: 0,
    gcTime: 0,
    // Se lee una sola vez al abrir: una recarga en segundo plano que fallara desmontaría el formulario
    // con lo escrito (contraseña incluida), y una exitosa cambiaría los datos contra los que se avisa.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('sources.connection.title', { ns: 'inbound', name: source.displayName })}
      description={t('sources.connection.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {query.isPending ? <Spinner label={t('state.loading', { ns: 'common' })} /> : null}
      {query.isError && query.data === undefined ? (
        <div className="flex flex-col gap-4">
          <ErrorAlert error={query.error} />
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('dialog.close', { ns: 'common' })}
            </Button>
          </div>
        </div>
      ) : null}
      {query.data !== undefined ? (
        <ConnectionForm
          source={source}
          connection={query.data}
          onCancel={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}
