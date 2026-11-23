import type { CredentialTotp } from '@iam/contracts';
import { StatusBadge, type Status } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';
import { viewStatusOf, type TotpViewStatus } from '../model/totp-model';

const STATUS_TONES: Readonly<Record<TotpViewStatus, Status>> = {
  none: 'neutral',
  pending: 'warning',
  verified: 'success',
  retired: 'neutral',
};

export type TotpStatusSummaryProps = {
  /** `null` cuando la credencial no tiene segundo factor. */
  totp: CredentialTotp | null;
  /** Zona horaria del perfil, para las fechas. */
  timeZone: string | undefined;
};

/**
 * Estado del segundo factor: metadatos solamente (nunca la clave ni el enlace). El estado se dice
 * con ícono y texto, no solo con color.
 */
export function TotpStatusSummary({ totp, timeZone }: TotpStatusSummaryProps) {
  const { t, i18n } = useTranslation('credentials');
  const status = viewStatusOf(totp);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={STATUS_TONES[status]} label={t(`totp.status.${status}`)} />
        {totp?.exposed === true ? <StatusBadge status="danger" label={t('totp.exposed')} /> : null}
      </div>
      {totp === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-secondary">{t('totp.field.algorithm')}</dt>
          <dd className="text-text">{totp.algorithm}</dd>
          <dt className="text-text-secondary">{t('totp.field.digits')}</dt>
          <dd className="text-text tabular-nums">{totp.digits}</dd>
          <dt className="text-text-secondary">{t('totp.field.period')}</dt>
          <dd className="text-text tabular-nums">
            {t('totp.seconds', { seconds: totp.periodSeconds })}
          </dd>
          <dt className="text-text-secondary">{t('totp.field.registeredAt')}</dt>
          <dd className="text-text">
            {formatDateTime(totp.registeredAt, i18n.language, timeZone)}
          </dd>
          <dt className="text-text-secondary">{t('totp.field.verifiedAt')}</dt>
          <dd className="text-text">
            {totp.verifiedAt === null
              ? t('totp.notVerified')
              : formatDateTime(totp.verifiedAt, i18n.language, timeZone)}
          </dd>
        </dl>
      )}
    </div>
  );
}
