import type { Credential, ShareLevel } from '@iam/contracts';
import {
  Badge,
  Button,
  Copy,
  EmptyState,
  Eye,
  KeyRound,
  RowActionsMenu,
  Skeleton,
  type RowActionItem,
} from '@iam/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type CredentialCardsProps = {
  credentials: Credential[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Zona horaria del perfil, para las fechas. */
  timeZone: string | undefined;
  /** Nivel en la cuenta, para explicar por qué no se puede revelar. */
  myLevel: ShareLevel | null;
  /** Decisiones de comodidad (permiso + nivel) que toma el container; el servidor decide siempre. */
  canCopyUsername: boolean;
  canReveal: boolean;
  canChangePassword: boolean;
  canViewHistory: boolean;
  /** Abrir el diálogo del segundo factor: permiso `credential.use_totp` y nivel USE. */
  canOpenTotp: boolean;
  onCopyUsername: (credential: Credential) => void;
  onReveal: (credential: Credential) => void;
  onChangePassword: (credential: Credential) => void;
  onViewHistory: (credential: Credential) => void;
  onOpenTotp: (credential: Credential) => void;
};

/** Valor oculto: nunca se pinta el usuario ni la contraseña en el listado. */
const MASK = '••••••••••';

/**
 * Selector del disparador del menú "⋯" de una tarjeta. El container lo usa para devolver el foco a
 * un elemento que siga montado cuando se cierra un diálogo abierto desde ese menú.
 */
export function rowMenuTriggerSelector(credentialId: string): string {
  return `[data-credential-row-menu="${credentialId}"] button`;
}

/**
 * Credenciales en tarjetas, como el detalle de cuenta del diseño de Compass: una fila por dato
 * (usuario, contraseña, segundo factor) con su acción al lado. Presentacional: nunca recibe usuario
 * ni contraseña, solo los metadatos del listado; copiar, revelar y el segundo factor los resuelven
 * los diálogos del container.
 */
export function CredentialCards({
  credentials,
  status,
  errorMessage,
  onRetry,
  timeZone,
  myLevel,
  canCopyUsername,
  canReveal,
  canChangePassword,
  canViewHistory,
  canOpenTotp,
  onCopyUsername,
  onReveal,
  onChangePassword,
  onViewHistory,
  onOpenTotp,
}: CredentialCardsProps) {
  const { t, i18n } = useTranslation(['credentials', 'common']);

  if (status === 'loading') {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p className="sr-only">{t('table.loading', { ns: 'common' })}</p>
        {[0, 1].map((index) => (
          <div
            key={index}
            aria-hidden="true"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5"
          >
            <Skeleton className="w-1/3" />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-4 py-10 text-center"
      >
        <p className="text-sm text-danger">{errorMessage}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('actions.retry', { ns: 'common' })}
        </Button>
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          title={t('empty.title', { ns: 'credentials' })}
          description={t('empty.description', { ns: 'credentials' })}
        />
      </div>
    );
  }

  // Cambiar contraseña e historial viven en el menú "⋯"; sin ninguno, el menú no se pinta.
  function menuItemsFor(credential: Credential): RowActionItem[] {
    const items: RowActionItem[] = [];
    if (canChangePassword) {
      items.push({
        id: 'changePassword',
        label: t('action.changePassword', { ns: 'credentials' }),
        onSelect: () => {
          onChangePassword(credential);
        },
      });
    }
    if (canViewHistory) {
      items.push({
        id: 'history',
        label: t('action.history', { ns: 'credentials' }),
        onSelect: () => {
          onViewHistory(credential);
        },
      });
    }
    return items;
  }

  return (
    <ul aria-label={t('caption', { ns: 'credentials' })} className="flex flex-col gap-4">
      {credentials.map((credential) => {
        const items = menuItemsFor(credential);
        const hasPassword = credential.kind !== 'totp_only';
        const headingId = `credential-${credential.id}`;
        return (
          <li key={credential.id}>
            <section
              aria-labelledby={headingId}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h2 id={headingId} className="text-base font-bold text-text">
                  {credential.label}
                </h2>
                <Badge>{t(`kind.${credential.kind}`, { ns: 'credentials' })}</Badge>
                {items.length > 0 ? (
                  // El contenedor marca la tarjeta para que el container devuelva el foco al
                  // disparador del menú al cerrar un diálogo abierto desde él.
                  <span className="ms-auto" data-credential-row-menu={credential.id}>
                    <RowActionsMenu
                      label={t('action.rowMenu', { ns: 'credentials', label: credential.label })}
                      items={items}
                    />
                  </span>
                ) : null}
              </div>

              <dl className="flex flex-col divide-y divide-border rounded-md border border-border">
                <SecretRow label={t('field.username', { ns: 'credentials' })}>
                  {canCopyUsername ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={t('action.copyUsernameLabel', {
                        ns: 'credentials',
                        label: credential.label,
                      })}
                      onClick={() => {
                        onCopyUsername(credential);
                      }}
                    >
                      <Copy aria-hidden="true" className="size-4" />
                      {t('action.copy', { ns: 'credentials' })}
                    </Button>
                  ) : null}
                </SecretRow>

                {hasPassword ? (
                  <SecretRow label={t('field.password', { ns: 'credentials' })}>
                    {canReveal ? (
                      // Su nombre accesible empieza con el texto visible (WCAG 2.5.3).
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t('action.revealLabel', {
                          ns: 'credentials',
                          label: credential.label,
                        })}
                        onClick={() => {
                          onReveal(credential);
                        }}
                      >
                        <Eye aria-hidden="true" className="size-4" />
                        {t('action.reveal', { ns: 'credentials' })}
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {myLevel === 'USE'
                          ? t('reveal.notAllowedLevel', {
                              ns: 'credentials',
                              level: t(`level.${myLevel}`, { ns: 'credentials' }),
                            })
                          : t('reveal.notAllowed', { ns: 'credentials' })}
                      </span>
                    )}
                  </SecretRow>
                ) : null}

                {/* Siempre que se pueda abrir: desde ahí también se registra un segundo factor nuevo. */}
                {canOpenTotp ? (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <dt className="w-32 shrink-0 text-sm text-text-muted">
                      {t('field.totp', { ns: 'credentials' })}
                    </dt>
                    <dd className="flex flex-1 justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={t('action.totpLabel', {
                          ns: 'credentials',
                          label: credential.label,
                        })}
                        onClick={() => {
                          onOpenTotp(credential);
                        }}
                      >
                        <KeyRound aria-hidden="true" className="size-4" />
                        {t('action.totp', { ns: 'credentials' })}
                      </Button>
                    </dd>
                  </div>
                ) : null}
              </dl>

              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>
                  {credential.lastRotatedAt === null
                    ? t('rotated.never', { ns: 'credentials' })
                    : t('meta.rotated', {
                        ns: 'credentials',
                        date: formatDateTime(credential.lastRotatedAt, i18n.language, timeZone),
                      })}
                </span>
                <span>
                  {t('meta.created', {
                    ns: 'credentials',
                    date: formatDateTime(credential.createdAt, i18n.language, timeZone),
                  })}
                </span>
              </p>
            </section>
          </li>
        );
      })}
    </ul>
  );
}

/** Fila de un dato secreto: etiqueta, valor oculto y la acción que corresponda. */
function SecretRow({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation('credentials');
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <dt className="w-32 shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
        <span className="font-mono tracking-widest text-text-secondary">
          <span aria-hidden="true">{MASK}</span>
          <span className="sr-only">{t('field.hidden')}</span>
        </span>
        {children}
      </dd>
    </div>
  );
}
