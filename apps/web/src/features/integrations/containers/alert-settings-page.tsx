import { ErrorCode, type InfrastructureAlertChannels } from '@iam/contracts';
import { Alert, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { ErrorAlert } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { formatDateTime } from '../../../shared/lib';
import { useToast } from '../../../shared/toast';
import { fetchAlertSettings, integrationsKeys, saveAlertSettings } from '../api/integrations-api';
import { hasActiveChannel } from '../model/alert-settings-model';
import { AlertSettingsForm } from '../ui/alert-settings-form';

/**
 * Container de `/alerts`: a qué canales llegan las alertas de infraestructura. El permiso
 * `alerts.infra.manage` lo comprueba la ruta como comodidad; el servidor decide siempre.
 */
export function AlertSettingsPage() {
  const catalogReady = useLazyCatalog('integrations');
  const { t, i18n } = useTranslation(['integrations', 'common', 'errors']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  // `null` = la persona aún no tocó nada: se muestran los valores del servidor. Así no hace falta
  // copiar la consulta a un estado con un efecto, y recargar tras un conflicto es soltar el borrador.
  const [draft, setDraft] = useState<InfrastructureAlertChannels | null>(null);
  const [conflict, setConflict] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Siempre se recarga al volver: otra Raíz pudo cambiar los canales desde otra sesión.
  const query = useQuery({
    queryKey: integrationsKeys.alertSettings(),
    queryFn: ({ signal }) => fetchAlertSettings(signal),
    staleTime: 0,
  });
  const action = useAsyncAction(saveAlertSettings);
  const cooldown = useRateLimitCooldown(action.error);
  // Igual que en los formularios vecinos, el rechazo por canales se deriva del error de la acción.
  const serverRejectedChannels =
    action.error instanceof ApiError &&
    action.error.code === ErrorCode.INTEGRATIONS_ALERT_CHANNEL_REQUIRED;

  // El rechazo por canales se explica junto al botón; cualquier otro error va a la región de avisos.
  const showsSaveError = action.error !== undefined && !serverRejectedChannels;
  const showsFeedback = conflict || showsSaveError;
  useEffect(() => {
    // El aviso aparece tras pulsar «Guardar»: se lleva el foco a él para que se lea y no se pierda.
    if (showsFeedback) feedbackRef.current?.focus();
  }, [showsFeedback]);

  if (!catalogReady || query.isPending) {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('alerts.title')} />
        <ErrorAlert
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </>
    );
  }

  const settings = query.data;
  const channels = draft ?? settings.infrastructure;
  const channelRequiredMessage = t('INTEGRATIONS.ALERT_CHANNEL_REQUIRED', { ns: 'errors' });
  // El mensaje del servidor y el del cliente son el mismo texto: la regla es una sola.
  const blockedReason =
    !hasActiveChannel(channels) || serverRejectedChannels ? channelRequiredMessage : undefined;

  async function submit() {
    if (!hasActiveChannel(channels)) return;
    setConflict(false);
    const result = await action.run(channels, settings.version);
    if (result.ok) {
      queryClient.setQueryData(integrationsKeys.alertSettings(), result.value);
      setDraft(null);
      toast.show(t('alerts.saved'), 'success');
      return;
    }
    const error = result.error;
    if (error instanceof ApiError && error.code === ErrorCode.CONFLICT_VERSION) {
      // Se descarta el borrador y se traen los valores vigentes para que la persona los revise.
      setConflict(true);
      setDraft(null);
      action.reset();
      void queryClient.invalidateQueries({ queryKey: integrationsKeys.alertSettings() });
    }
  }

  return (
    <>
      <PageHeader title={t('alerts.title')} description={t('alerts.description')} />
      <div className="mt-6 flex max-w-2xl flex-col gap-4">
        {settings.version === 0 ? <Alert tone="info">{t('alerts.defaults')}</Alert> : null}
        <div ref={feedbackRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
          {conflict ? <Alert tone="warning">{t('alerts.conflict')}</Alert> : null}
          {showsSaveError ? (
            <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
          ) : null}
        </div>
        <p className="text-sm text-text-secondary">{t('alerts.rule')}</p>
        <AlertSettingsForm
          channels={channels}
          labels={{
            legend: t('alerts.channels.legend'),
            emailLabel: t('alerts.channels.email.label'),
            emailDescription: t('alerts.channels.email.description'),
            telegramLabel: t('alerts.channels.telegram.label'),
            telegramDescription: t('alerts.channels.telegram.description'),
            save: t('alerts.save'),
          }}
          blockedReason={blockedReason}
          saving={action.pending}
          cooldownSeconds={cooldown.secondsLeft}
          onChange={(next) => {
            setDraft(next);
            // Al cambiar los canales, el rechazo anterior ya no aplica; otros errores siguen a la vista.
            if (serverRejectedChannels) action.reset();
          }}
          onSubmit={() => {
            void submit();
          }}
        />
        {settings.updatedAt !== null ? (
          <p className="text-sm text-text-muted">
            {t('alerts.updatedAt', {
              date: formatDateTime(settings.updatedAt, i18n.language, timeZone),
            })}
          </p>
        ) : null}
      </div>
    </>
  );
}
