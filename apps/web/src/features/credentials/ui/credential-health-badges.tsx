import type { CredentialHealth, CredentialHealthSignal } from '@iam/contracts';
import { AlertTriangle, Badge, Info, type BadgeProps } from '@iam/ui';
import { useTranslation } from 'react-i18next';

export type CredentialHealthBadgesProps = {
  /** `undefined` cuando la salud no está disponible (cargando o con error). */
  health: CredentialHealth | undefined;
  /** Estado de la consulta de salud; decide qué se muestra cuando falta `health`. */
  status: 'loading' | 'success' | 'error';
};

type SignalPresentation = { tone: NonNullable<BadgeProps['tone']>; icon: 'warning' | 'info' };

// La advertencia usa el naranja del sistema (`warning`), nunca el acento latón. Falta o
// confirmación pendiente del segundo factor es informativo; el resto pide atención.
const SIGNAL_PRESENTATION: Record<CredentialHealthSignal, SignalPresentation> = {
  weak_password: { tone: 'warning', icon: 'warning' },
  reused_password: { tone: 'warning', icon: 'warning' },
  stale_password: { tone: 'warning', icon: 'warning' },
  totp_missing: { tone: 'info', icon: 'info' },
  totp_pending: { tone: 'info', icon: 'info' },
  totp_exposed: { tone: 'warning', icon: 'warning' },
  rotation_pending: { tone: 'warning', icon: 'warning' },
};

/**
 * Salud de una credencial: chips de señales (ícono + texto, el color solo refuerza) y puntaje de
 * fortaleza como texto. Son avisos informativos: no bloquean ninguna acción. Presentacional.
 */
export function CredentialHealthBadges({ health, status }: CredentialHealthBadgesProps) {
  const { t } = useTranslation('credentials');

  if (health === undefined) {
    if (status === 'loading') {
      return <span className="text-xs text-text-muted">{t('health.loading')}</span>;
    }
    // El guion es solo visual: el texto oculto da el mismo dato a los lectores de pantalla.
    return (
      <span className="text-xs text-text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('health.unavailableCell')}</span>
      </span>
    );
  }

  const score =
    health.strengthScore === null
      ? t('health.score.unmeasured')
      : t('health.score.value', { score: health.strengthScore });

  return (
    <div className="flex flex-col gap-1">
      {health.signals.length === 0 ? (
        <span className="text-xs text-text-secondary">{t('health.none')}</span>
      ) : (
        <ul
          aria-label={t('health.signalsLabel')}
          className="m-0 flex list-none flex-wrap gap-1 p-0"
        >
          {health.signals.map((signal) => {
            const presentation = SIGNAL_PRESENTATION[signal];
            const Icon = presentation.icon === 'warning' ? AlertTriangle : Info;
            return (
              <li key={signal}>
                <Badge tone={presentation.tone}>
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  {t(`health.signal.${signal}`)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <span className="text-xs text-text-muted">{score}</span>
    </div>
  );
}
