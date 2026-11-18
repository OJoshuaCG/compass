import type { SmtpSettings } from '@iam/contracts';
import { Alert, Button, Card, CardBody, Spinner, StatusBadge } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { fetchSmtpSettings, integrationsKeys, sendSmtpTest } from '../api/integrations-api';
import { findActiveSmtpSettings, isSmtpTestFailureCode } from '../model/smtp-settings-model';
import { ArchiveSmtpSettingsDialog } from './archive-smtp-settings-dialog';
import { SmtpPasswordDialog } from './smtp-password-dialog';
import { SmtpSettingsDialog } from './smtp-settings-dialog';

type OpenDialog = 'settings' | 'password' | 'archive' | null;

type SmtpDetailsProps = {
  settings: SmtpSettings;
  onEdit: () => void;
  onChangePassword: () => void;
  onArchive: () => void;
};

/** Datos del servidor vigente y sus acciones. La contraseña nunca se muestra: solo si hay una guardada. */
function SmtpDetails({ settings, onEdit, onChangePassword, onArchive }: SmtpDetailsProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const test = useAsyncAction(() => sendSmtpTest(settings.id));
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
        <dt className="text-text-secondary">{t('smtp.details.name', { ns: 'integrations' })}</dt>
        <dd className="break-words text-text">{settings.name}</dd>
        <dt className="text-text-secondary">{t('smtp.details.server', { ns: 'integrations' })}</dt>
        <dd className="break-all font-mono text-text">
          {settings.host}:{settings.port}
        </dd>
        <dt className="text-text-secondary">
          {t('smtp.details.security', { ns: 'integrations' })}
        </dt>
        <dd className="text-text">
          {t(`smtp.security.${settings.security}`, { ns: 'integrations' })}
        </dd>
        <dt className="text-text-secondary">
          {t('smtp.details.username', { ns: 'integrations' })}
        </dt>
        <dd className="break-all font-mono text-text">{settings.username}</dd>
        <dt className="text-text-secondary">
          {t('smtp.details.fromAddress', { ns: 'integrations' })}
        </dt>
        <dd className="break-all font-mono text-text">{settings.fromAddress}</dd>
        <dt className="text-text-secondary">
          {t('smtp.details.password', { ns: 'integrations' })}
        </dt>
        <dd>
          <StatusBadge
            status={settings.hasPassword ? 'success' : 'warning'}
            label={
              settings.hasPassword
                ? t('smtp.details.passwordSaved', { ns: 'integrations' })
                : t('smtp.details.passwordMissing', { ns: 'integrations' })
            }
          />
        </dd>
      </dl>
      {test.error !== undefined ? (
        <ErrorAlert error={test.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
      {outcome === 'sent' ? (
        <Alert tone="success">
          {t('smtp.test.sent', { ns: 'integrations', address: settings.fromAddress })}
        </Alert>
      ) : null}
      {outcome !== undefined && isSmtpTestFailureCode(outcome) ? (
        <Alert tone="warning">{t(`smtp.test.${outcome}`, { ns: 'integrations' })}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          loading={test.pending}
          disabled={!settings.hasPassword || cooldown.secondsLeft > 0}
          onClick={() => {
            void runTest();
          }}
        >
          {t('smtp.actions.test', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          {t('smtp.actions.edit', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onChangePassword}>
          {t('smtp.actions.changePassword', { ns: 'integrations' })}
        </Button>
        <Button variant="secondary" onClick={onArchive}>
          {t('smtp.actions.archive', { ns: 'integrations' })}
        </Button>
      </div>
    </div>
  );
}

/**
 * Servidor SMTP con el que la organización envía su correo. Sin servidor activo rige el del entorno de
 * la plataforma. El permiso `alerts.infra.manage` lo comprueba la ruta como comodidad; el servidor decide
 * siempre y pide reautenticación en cada escritura.
 */
export function SmtpSettingsSection() {
  const { t } = useTranslation(['integrations', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const query = useQuery({
    queryKey: integrationsKeys.smtp(),
    queryFn: ({ signal }) => fetchSmtpSettings(signal),
    staleTime: 0,
  });

  function finish(messageKey: string) {
    setDialog(null);
    toast.show(t(messageKey, { ns: 'integrations' }), 'success');
    void queryClient.invalidateQueries({ queryKey: integrationsKeys.smtp() });
  }

  const settings = query.data === undefined ? undefined : findActiveSmtpSettings(query.data.data);

  return (
    <section aria-labelledby="smtp-settings-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="smtp-settings-title" className="text-base font-medium text-text">
          {t('smtp.title', { ns: 'integrations' })}
        </h2>
        <p className="text-sm text-text-secondary">
          {t('smtp.description', { ns: 'integrations' })}
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
          {query.isSuccess && settings === undefined ? (
            <div className="flex flex-col gap-4">
              <Alert tone="info">{t('smtp.empty', { ns: 'integrations' })}</Alert>
              <div>
                <Button
                  onClick={() => {
                    setDialog('settings');
                  }}
                >
                  {t('smtp.actions.configure', { ns: 'integrations' })}
                </Button>
              </div>
            </div>
          ) : null}
          {query.isSuccess && settings !== undefined ? (
            <SmtpDetails
              settings={settings}
              onEdit={() => {
                setDialog('settings');
              }}
              onChangePassword={() => {
                setDialog('password');
              }}
              onArchive={() => {
                setDialog('archive');
              }}
            />
          ) : null}
        </CardBody>
      </Card>
      {dialog === 'settings' ? (
        <SmtpSettingsDialog
          settings={settings}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={() => {
            finish(settings === undefined ? 'smtp.created' : 'smtp.updated');
          }}
        />
      ) : null}
      {dialog === 'password' && settings !== undefined ? (
        <SmtpPasswordDialog
          settings={settings}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={() => {
            finish('smtp.passwordSaved');
          }}
        />
      ) : null}
      {dialog === 'archive' && settings !== undefined ? (
        <ArchiveSmtpSettingsDialog
          settings={settings}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            finish('smtp.archived');
          }}
        />
      ) : null}
    </section>
  );
}
