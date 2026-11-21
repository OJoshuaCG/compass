import type { Credential } from '@iam/contracts';
import { Badge, Button, KeyRound, Skeleton } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type AccountCredentialsListProps = {
  accountId: string;
  accountName: string;
  status: 'loading' | 'success' | 'error';
  credentials: readonly Credential[];
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  timeZone: string | undefined;
};

/**
 * Credenciales de una cuenta dentro de la lista en árbol. Solo metadatos (etiqueta, tipo y fecha de
 * rotación): el usuario y la contraseña no se muestran aquí; se piden en la pantalla de la cuenta,
 * con su confirmación de identidad y su auditoría. Presentacional.
 */
export function AccountCredentialsList({
  accountId,
  accountName,
  status,
  credentials,
  errorMessage,
  onRetry,
  timeZone,
}: AccountCredentialsListProps) {
  const { t, i18n } = useTranslation('accounts');

  if (status === 'loading') {
    return (
      <div role="status" className="flex flex-col gap-2 ps-4">
        <span className="sr-only">{t('tree.loading')}</span>
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 ps-4 text-sm text-danger">
        <span>{errorMessage === '' ? t('tree.error') : errorMessage}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('actions.retry', { ns: 'common' })}
        </Button>
      </div>
    );
  }
  if (credentials.length === 0) {
    return <p className="ps-4 text-sm text-text-muted">{t('tree.empty')}</p>;
  }
  return (
    <ul
      aria-label={t('tree.listLabel', { name: accountName })}
      className="m-0 flex list-none flex-col gap-2 border-s-2 border-border-strong ps-4"
    >
      {credentials.map((credential) => (
        <li key={credential.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <KeyRound aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
          <span className="font-semibold text-text">{credential.label}</span>
          <Badge>{t(`tree.kind.${credential.kind}`)}</Badge>
          <span className="text-xs text-text-muted">
            {credential.lastRotatedAt === null
              ? t('tree.rotatedNever')
              : t('tree.rotated', {
                  date: formatDateTime(credential.lastRotatedAt, i18n.language, timeZone),
                })}
          </span>
          <Link
            to="/accounts/$accountId/credentials"
            params={{ accountId }}
            className="ms-auto text-xs text-text-secondary hover:text-accent hover:underline"
          >
            {t('tree.open')}
            <span className="sr-only"> {accountName}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
