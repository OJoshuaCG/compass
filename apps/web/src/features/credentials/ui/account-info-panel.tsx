import type { Account, Credential } from '@iam/contracts';
import { Panel } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type AccountInfoPanelProps = {
  account: Account;
  /** Nombre de la plataforma, si ya llegó el catálogo. */
  platformName: string | undefined;
  /** Credenciales cargadas, para la rotación más reciente; `undefined` mientras cargan. */
  credentials: Credential[] | undefined;
  timeZone: string | undefined;
};

/** Rotación más reciente entre las credenciales de la cuenta, o `null` si ninguna se ha rotado. */
function latestRotation(credentials: readonly Credential[]): string | null {
  let latest: string | null = null;
  for (const credential of credentials) {
    const at = credential.lastRotatedAt;
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * "Información de la cuenta" del detalle (diseño de Compass): plataforma, identificador, última
 * rotación y alta. Solo metadatos; nunca usuario ni contraseña.
 */
export function AccountInfoPanel({
  account,
  platformName,
  credentials,
  timeZone,
}: AccountInfoPanelProps) {
  const { t, i18n } = useTranslation('credentials');
  const date = (iso: string) => formatDateTime(iso, i18n.language, timeZone);
  const rotated = credentials === undefined ? undefined : latestRotation(credentials);
  const rows: [string, string][] = [
    [t('info.platform'), platformName ?? t('info.none')],
    [t('info.handle'), account.handle ?? t('info.none')],
    [
      t('info.lastRotation'),
      rotated === undefined
        ? t('info.none')
        : rotated === null
          ? t('rotated.never')
          : date(rotated),
    ],
    [t('info.created'), date(account.createdAt)],
  ];
  return (
    <Panel title={t('info.title')}>
      <dl className="flex flex-col divide-y divide-border px-5 py-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 py-2.5">
            <dt className="w-32 shrink-0 text-text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
