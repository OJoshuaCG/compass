import type { TelegramIntegration } from '@iam/contracts';
import { Alert, Button, Card, CardBody, Spinner, StatusBadge } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import {
  fetchTelegramIntegrations,
  integrationsKeys,
  sendTelegramTest,
} from '../api/integrations-api';
import { findActiveInfraChannel, isTelegramTestFailureCode } from '../model/telegram-channel-model';
import { ArchiveTelegramChannelDialog } from './archive-telegram-channel-dialog';
import { TelegramChannelDialog } from './telegram-channel-dialog';
import { TelegramTokenDialog } from './telegram-token-dialog';

type OpenDialog = 'channel' | 'token' | 'archive' | null;

type ChannelDetailsProps = {
  channel: TelegramIntegration;
  onEdit: () => void;
  onChangeToken: () => void;
  onArchive: () => void;
};

/** Datos del canal vigente y sus acciones. El token nunca se muestra: solo si hay uno guardado. */
function ChannelDetails({ channel, onEdit, onChangeToken, onArchive }: ChannelDetailsProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const test = useAsyncAction(() => sendTelegramTest(channel.id));
  const cooldown = useRateLimitCooldown(test.error);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);

  async function runTest() {
    setOutcome(undefined);
    const result = await test.run();
    if (result.ok) setOutcome(result.value.outcome);
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        <dt className="text-text-secondary">
          {t('telegram.details.name', { ns: 'integrations' })}
        </dt>
        <dd className="text-text">{channel.name}</dd>
        <dt className="text-text-secondary">
          {t('telegram.details.chatId', { ns: 'integrations' })}
        </dt>
        <dd className="break-all font-mono text-text">{channel.chatId}</dd>
        <dt className="text-text-secondary">
          {t('telegram.details.botToken', { ns: 'integrations' })}
        </dt>
        <dd>
          <StatusBadge
            status={channel.hasBotToken ? 'success' : 'warning'}
            label={
              channel.hasBotToken
                ? t('telegram.details.tokenSaved', { ns: 'integrations' })
                : t('telegram.details.tokenMissing', { ns: 'integrations' })
            }
          />
        </dd>
      </dl>
      {test.error !== undefined ? (
        <ErrorAlert error={test.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      {outcome === 'sent' ? (
        <Alert tone="success">{t('telegram.test.sent', { ns: 'integrations' })}</Alert>
      ) : null}
      {outcome !== undefined && isTelegramTestFailureCode(outcome) ? (
        <Alert tone="warning">{t(`telegram.test.${outcome}`, { ns: 'integrations' })}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          loading={test.pending}
          disabled={!channel.hasBotToken || cooldown.secondsLeft > 0}
          onClick={() => {
            void runTest();
          }}
        >
          {t('telegram.actions.test', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          {t('telegram.actions.edit', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onChangeToken}>
          {t('telegram.actions.changeToken', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onArchive}>
          {t('telegram.actions.archive', { ns: 'integrations' })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Configuración del canal de Telegram de las alertas de infraestructura: el bot (token de BotFather) y el
 * chat al que llegan los avisos. El permiso `alerts.infra.manage` lo comprueba la ruta como comodidad;
 * el servidor decide siempre y pide reautenticación en cada escritura.
 */
export function TelegramChannelSection() {
  const { t } = useTranslation(['integrations', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const query = useQuery({
    queryKey: integrationsKeys.telegram(),
    queryFn: ({ signal }) => fetchTelegramIntegrations(signal),
    staleTime: 0,
  });

  function finish(messageKey: string) {
    setDialog(null);
    toast.show(t(messageKey, { ns: 'integrations' }), 'success');
    void queryClient.invalidateQueries({ queryKey: integrationsKeys.telegram() });
  }

  const channel = query.data === undefined ? undefined : findActiveInfraChannel(query.data.data);

  return (
    <section aria-labelledby="telegram-channel-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="telegram-channel-title" className="text-base font-medium text-text">
          {t('telegram.title', { ns: 'integrations' })}
        </h2>
        <p className="text-sm text-text-secondary">
          {t('telegram.description', { ns: 'integrations' })}
        </p>
      </div>
      <Card>
        <CardBody>
          {query.isPending ? <Spinner label={t('state.loading', { ns: 'common' })} /> : null}
          {query.isError ? (
            <ErrorAlert
              error={query.error}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : null}
          {query.isSuccess && channel === undefined ? (
            <div className="flex flex-col gap-4">
              <Alert tone="info">{t('telegram.empty', { ns: 'integrations' })}</Alert>
              <div>
                <Button
                  onClick={() => {
                    setDialog('channel');
                  }}
                >
                  {t('telegram.actions.configure', { ns: 'integrations' })}
                </Button>
              </div>
            </div>
          ) : null}
          {query.isSuccess && channel !== undefined ? (
            <ChannelDetails
              channel={channel}
              onEdit={() => {
                setDialog('channel');
              }}
              onChangeToken={() => {
                setDialog('token');
              }}
              onArchive={() => {
                setDialog('archive');
              }}
            />
          ) : null}
        </CardBody>
      </Card>
      {dialog === 'channel' ? (
        <TelegramChannelDialog
          channel={channel}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={() => {
            finish(channel === undefined ? 'telegram.created' : 'telegram.updated');
          }}
        />
      ) : null}
      {dialog === 'token' && channel !== undefined ? (
        <TelegramTokenDialog
          channel={channel}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={() => {
            finish('telegram.tokenSaved');
          }}
        />
      ) : null}
      {dialog === 'archive' && channel !== undefined ? (
        <ArchiveTelegramChannelDialog
          channel={channel}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            finish('telegram.archived');
          }}
        />
      ) : null}
    </section>
  );
}
