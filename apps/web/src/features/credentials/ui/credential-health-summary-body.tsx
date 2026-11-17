import type { CredentialHealthSignal, CredentialHealthSummary } from '@iam/contracts';
import { AlertTriangle, EmptyState, Info, Spinner } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ErrorAlert } from '../../../shared/i18n';

export type CredentialHealthSummaryBodyProps = {
  status: 'loading' | 'success' | 'error';
  /** Solo con `status === 'success'`. */
  summary: CredentialHealthSummary | undefined;
  /** Solo con `status === 'error'`. */
  error: unknown;
  /** Se ofrece "Reintentar" solo si tiene sentido repetir la consulta (red o 5xx). */
  onRetry?: (() => void) | undefined;
  /** Nombre de lo que se resume (la organización o un grupo), para el anuncio a lectores de pantalla. */
  subject: string;
};

const SIGNALS: readonly CredentialHealthSignal[] = [
  'weak_password',
  'reused_password',
  'stale_password',
  'totp_missing',
  'totp_pending',
  'totp_exposed',
  'rotation_pending',
];

// Misma lectura que los chips de la tabla de credenciales: la advertencia es naranja (`warning`) y
// la falta o confirmación pendiente del segundo factor es informativa. El texto lleva el
// significado; el ícono y el color solo lo refuerzan.
const INFORMATIVE_SIGNALS: ReadonlySet<CredentialHealthSignal> = new Set([
  'totp_missing',
  'totp_pending',
]);

/**
 * Señales de mayor a menor conteo para atender primero lo más extendido. El desempate conserva el
 * orden fijo de `SIGNALS` (`sort` es estable), así la lista no baila entre consultas.
 */
export function sortSignalsByCount(
  bySignal: CredentialHealthSummary['bySignal'],
): { signal: CredentialHealthSignal; count: number }[] {
  return SIGNALS.map((signal) => ({ signal, count: bySignal[signal] })).sort(
    (first, second) => second.count - first.count,
  );
}

/**
 * Contenido de un panel de salud: solo conteos, nunca nombres, etiquetas ni secretos. Presentacional;
 * la tarjeta y el encabezado los pone quien lo use.
 */
export function CredentialHealthSummaryBody({
  status,
  summary,
  error,
  onRetry,
  subject,
}: CredentialHealthSummaryBodyProps) {
  const { t } = useTranslation(['credentials', 'common']);

  if (status === 'loading') {
    return <Spinner label={t('state.loading', { ns: 'common' })} />;
  }
  if (status === 'error' || summary === undefined) {
    return <ErrorAlert error={error} {...(onRetry === undefined ? {} : { onRetry })} />;
  }
  if (summary.credentials === 0) {
    return (
      <EmptyState
        title={t('healthSummary.empty.title')}
        description={t('healthSummary.empty.description')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Anuncia el resultado al cambiar de grupo sin leer la lista completa otra vez. */}
      <p role="status" className="sr-only">
        {t('healthSummary.announce', {
          subject,
          withSignals: summary.withSignals,
          count: summary.credentials,
        })}
      </p>
      <dl className="m-0 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-text-secondary">{t('healthSummary.total')}</dt>
          <dd className="m-0 font-mono text-2xl text-text">{summary.credentials}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-secondary">{t('healthSummary.withSignals')}</dt>
          <dd className="m-0 font-mono text-2xl text-text">
            {t('healthSummary.proportion', {
              value: summary.withSignals,
              total: summary.credentials,
            })}
          </dd>
        </div>
        {summary.strengthUnknown > 0 ? (
          <div>
            <dt className="text-sm text-text-secondary">{t('healthSummary.strengthUnknown')}</dt>
            <dd className="m-0 font-mono text-2xl text-text">{summary.strengthUnknown}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-text">{t('healthSummary.signals.title')}</h3>
        <p className="text-sm text-text-secondary">{t('healthSummary.signals.help')}</p>
        <ol className="m-0 flex list-none flex-col p-0">
          {sortSignalsByCount(summary.bySignal).map(({ signal, count }) => {
            const informative = INFORMATIVE_SIGNALS.has(signal);
            const Icon = informative ? Info : AlertTriangle;
            return (
              <li
                key={signal}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-b-0"
              >
                <span className="flex items-center gap-2 text-sm text-text">
                  <Icon
                    aria-hidden="true"
                    className={`size-4 shrink-0 ${informative ? 'text-info' : 'text-warning'}`}
                  />
                  {t(`health.signal.${signal}`)}
                </span>
                <span className="font-mono text-sm text-text-secondary">
                  {t('healthSummary.proportion', { value: count, total: summary.credentials })}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
