import { Alert, Button, CopyButton } from '@iam/ui';
import { useTranslation } from 'react-i18next';

/** Tiempo tras el cual se limpia el portapapeles si aún contiene el secreto (mejor esfuerzo, docs/frontend.md §9). */
const CLIPBOARD_CLEAR_MS = 30_000;

export type SecretPanelProps = {
  clientId: string;
  /** El secreto entra solo por props desde el estado local del diálogo que lo recibió; este panel no lo guarda. */
  clientSecret: string;
  onDone: () => void;
};

/**
 * Entrega única del secreto de un cliente OIDC. Fondo opaco (`bg-raised`), `font-mono text-accent`
 * y aviso de que no se vuelve a mostrar (ADR 0049; docs/frontend.md §17, regla 7).
 */
export function SecretPanel({ clientId, clientSecret, onDone }: SecretPanelProps) {
  const { t } = useTranslation(['oidcClients', 'common']);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">{t('secret.warning', { ns: 'oidcClients' })}</Alert>
      <dl className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <dt className="text-sm font-medium text-text">
            {t('secret.clientId', { ns: 'oidcClients' })}
          </dt>
          <dd className="flex min-w-0 flex-col gap-2">
            <code className="rounded-md border border-border-strong bg-raised p-3 font-mono text-sm break-all text-text">
              {clientId}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                size="sm"
                value={clientId}
                label={t('secret.copyClientId', { ns: 'oidcClients' })}
                copiedLabel={t('clipboard.copied', { ns: 'common' })}
                failedLabel={t('clipboard.failed', { ns: 'common' })}
              />
            </div>
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <dt className="text-sm font-medium text-text">
            {t('secret.secret', { ns: 'oidcClients' })}
          </dt>
          <dd className="flex min-w-0 flex-col gap-2">
            <code className="rounded-md border border-border-strong bg-raised p-3 font-mono text-sm break-all text-accent">
              {clientSecret}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                size="sm"
                value={clientSecret}
                label={t('secret.copy', { ns: 'oidcClients' })}
                copiedLabel={t('clipboard.copied', { ns: 'common' })}
                failedLabel={t('clipboard.failed', { ns: 'common' })}
                clearAfterMs={CLIPBOARD_CLEAR_MS}
              />
            </div>
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>{t('secret.done', { ns: 'oidcClients' })}</Button>
      </div>
    </div>
  );
}
