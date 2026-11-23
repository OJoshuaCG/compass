import type { Passkey } from '@iam/contracts';
import { Button, EmptyState, KeyRound, Panel, Skeleton } from '@iam/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type PasskeysListProps = {
  passkeys: Passkey[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onRemove: (passkey: Passkey) => void;
  /** Zona horaria del perfil, para mostrar las fechas. */
  timeZone: string | undefined;
  /** Botón de alta, si el navegador admite WebAuthn. */
  addAction?: ReactNode;
};

/**
 * Llaves de acceso propias en un panel con lista, como el diseño de Compass. Presentacional: solo
 * recibe lo que entrega el servidor (nombre y fechas; nunca llaves) y avisa qué llave se quiere
 * quitar. Son pocas (máximo 10), así que no paginan.
 */
export function PasskeysList({
  passkeys,
  status,
  errorMessage,
  onRetry,
  onRemove,
  timeZone,
  addAction,
}: PasskeysListProps) {
  const { t, i18n } = useTranslation(['security', 'common']);
  const date = (iso: string) => formatDateTime(iso, i18n.language, timeZone);

  return (
    <Panel title={t('panel.title', { ns: 'security' })} aside={addAction}>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm text-text-secondary">
          {t('panel.description', { ns: 'security' })}
        </p>
        {status === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <p className="sr-only">{t('table.loading', { ns: 'common' })}</p>
            <Skeleton className="w-1/2" />
            <Skeleton className="w-1/3" />
          </div>
        ) : status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-danger">{errorMessage}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('actions.retry', { ns: 'common' })}
            </Button>
          </div>
        ) : passkeys.length === 0 ? (
          <EmptyState
            title={t('empty.title', { ns: 'security' })}
            description={t('empty.description', { ns: 'security' })}
          />
        ) : (
          <ul
            aria-label={t('caption', { ns: 'security' })}
            className="flex flex-col divide-y divide-border"
          >
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center gap-3 py-3">
                <KeyRound aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-text">{passkey.name}</span>
                  <span className="text-xs text-text-muted">
                    {t('item.created', { ns: 'security', date: date(passkey.createdAt) })}
                    {' · '}
                    {passkey.lastUsedAt === null
                      ? t('lastUsed.never', { ns: 'security' })
                      : t('item.lastUsed', { ns: 'security', date: date(passkey.lastUsedAt) })}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  aria-label={t('action.removeLabel', { ns: 'security', name: passkey.name })}
                  onClick={() => {
                    onRemove(passkey);
                  }}
                >
                  {t('action.remove', { ns: 'security' })}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
