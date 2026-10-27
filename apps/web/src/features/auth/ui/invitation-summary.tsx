import type { Rank } from '@iam/contracts';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type InvitationSummaryProps = {
  email: string;
  rank: Rank;
  expiresAt: string;
};

/** Datos de la vista previa de la invitación: a quién y con qué rango se invita. */
export function InvitationSummary({ email, rank, expiresAt }: InvitationSummaryProps) {
  const { t, i18n } = useTranslation(['auth', 'common']);
  return (
    <dl
      aria-label={t('invitation.summary', { ns: 'auth' })}
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border border-border-strong bg-raised p-4 text-sm"
    >
      <dt className="text-text-secondary">{t('invitation.email', { ns: 'auth' })}</dt>
      <dd className="break-all text-text">{email}</dd>
      <dt className="text-text-secondary">{t('invitation.rank', { ns: 'auth' })}</dt>
      <dd className="text-text">{t(`rank.${String(rank)}`, { ns: 'common' })}</dd>
      <dt className="text-text-secondary">{t('invitation.expires', { ns: 'auth' })}</dt>
      <dd className="text-text">{formatDateTime(expiresAt, i18n.language)}</dd>
    </dl>
  );
}
