import type { SessionSummary } from '@iam/contracts';
import {
  Badge,
  Button,
  EmptyState,
  Monitor,
  Pagination,
  Panel,
  Skeleton,
  Smartphone,
} from '@iam/ui';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';
import { describeDevice } from '../model/describe-device';

export type SessionsListProps = {
  sessions: SessionSummary[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onClose: (session: SessionSummary) => void;
  /** Zona horaria del perfil, para mostrar las fechas. */
  timeZone: string | undefined;
  /** Tamaño y navegación de página que entrega el container. */
  paging: TablePaging;
};

/** Teléfono o tableta según el User-Agent; el ícono es decorativo (el texto dice el dispositivo). */
const MOBILE = /Mobi|Android|iPhone|iPad/i;

/**
 * Sesiones propias en un panel con lista, como el diseño de Compass: dispositivo, dirección IP,
 * última actividad y vencimiento, con la insignia de la sesión actual. Presentacional; la sesión
 * actual no se cierra aquí (para eso está "Cerrar sesión"). El pie de páginas solo aparece si hay más
 * de una página.
 */
export function SessionsList({
  sessions,
  status,
  errorMessage,
  onRetry,
  onClose,
  timeZone,
  paging,
}: SessionsListProps) {
  const { t, i18n } = useTranslation(['sessions', 'common']);
  const labels = useDataTableLabels();
  const date = (iso: string) => formatDateTime(iso, i18n.language, timeZone);
  const offset = paging.pagination.offset;
  const manyPages = paging.pagination.hasNext || paging.pagination.hasPrevious;

  return (
    <Panel title={t('panel.title', { ns: 'sessions' })}>
      <div className="px-5 py-2">
        {status === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-3 py-3">
            <p className="sr-only">{t('table.loading', { ns: 'common' })}</p>
            <Skeleton className="w-1/2" />
            <Skeleton className="w-1/3" />
          </div>
        ) : status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-3">
            <p className="text-sm text-danger">{errorMessage}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('actions.retry', { ns: 'common' })}
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title={t('empty.title', { ns: 'sessions' })}
            description={t('empty.description', { ns: 'sessions' })}
          />
        ) : (
          <ul
            aria-label={t('caption', { ns: 'sessions' })}
            className="flex flex-col divide-y divide-border"
          >
            {sessions.map((session) => {
              const device =
                describeDevice(session.userAgent) ?? t('device.unknown', { ns: 'sessions' });
              const Icon = MOBILE.test(session.userAgent ?? '') ? Smartphone : Monitor;
              return (
                <li key={session.id} className="flex items-center gap-3 py-3">
                  <Icon aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-text">{device}</span>
                    <span className="text-xs text-text-muted">
                      <span className="font-mono">
                        {session.ip ?? t('ip.unknown', { ns: 'sessions' })}
                      </span>
                      {' · '}
                      {t('item.lastSeen', { ns: 'sessions', date: date(session.lastSeenAt) })}
                      {' · '}
                      {t('item.expires', { ns: 'sessions', date: date(session.expiresAt) })}
                    </span>
                  </span>
                  {session.current ? (
                    <Badge tone="success">{t('badge.current', { ns: 'sessions' })}</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      aria-label={t('action.closeLabel', { ns: 'sessions', device })}
                      onClick={() => {
                        onClose(session);
                      }}
                    >
                      {t('action.close', { ns: 'sessions' })}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {manyPages && status === 'success' ? (
        <div className="border-t border-border p-3">
          <Pagination
            labels={labels.pagination}
            rangeText={labels.range({ from: offset + 1, to: offset + sessions.length })}
            limit={paging.limit}
            onLimitChange={paging.onLimitChange}
            hasPrevious={paging.pagination.hasPrevious}
            hasNext={paging.pagination.hasNext}
            onPrevious={paging.pagination.onPrevious}
            onNext={paging.pagination.onNext}
          />
        </div>
      ) : null}
    </Panel>
  );
}
