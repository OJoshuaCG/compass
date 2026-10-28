import {
  AlertTriangle,
  Badge,
  buttonVariants,
  CheckCircle2,
  ChevronRight,
  Clock,
  EmptyState,
  IconBubble,
  KeyRound,
  Mail,
  MonitorSmartphone,
  Panel,
  ShieldCheck,
  Skeleton,
  StatCard,
  Users,
  type LucideIcon,
} from '@iam/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, usePermission } from '../../../shared/auth';
import { formatDateTime, formatLongDate } from '../../../shared/lib';
import { directoryKeys, fetchPendingInvitations, fetchUsersPage } from '../../directory';
import { fetchMyPasskeys, passkeysKeys } from '../../security';
import { fetchMySessions, sessionsKeys } from '../../sessions';
import { buildAttention, countInvitations, type AttentionItem } from '../model/attention';
import { AttentionRow } from '../ui/attention-row';

/** El conteo del directorio se acota a una página: más allá se muestra "100+". */
const PEOPLE_LIMIT = 100;

const rowAction = buttonVariants({ variant: 'secondary', size: 'sm' });

/** Cifra de una tarjeta: `undefined` mientras carga, guion si falló (la pantalla no se rompe). */
function statValue(status: 'pending' | 'error' | 'success', value: string): string | undefined {
  if (status === 'pending') return undefined;
  return status === 'error' ? '—' : value;
}

function Shortcut({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: '/users' | '/sessions' | '/security' | '/roles';
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-4 px-5 py-4 hover:bg-raised focus-visible:-outline-offset-2"
      >
        <IconBubble icon={<Icon className="size-5" />} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold text-text">{title}</span>
          <span className="text-sm text-text-secondary">{description}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}

/**
 * Inicio: saludo, métricas de la fase 1a (directorio, invitaciones, sesiones y llaves de acceso),
 * pendientes que requieren atención y accesos rápidos. Cada consulta comparte la clave de caché de
 * su pantalla, así que al volver de ella los datos ya están frescos.
 */
export function HomePage() {
  const { t, i18n } = useTranslation('common');
  const me = useMe();
  const canInvite = usePermission('user.invite');
  const canManageRoles = usePermission('role.manage');
  const locale = i18n.language;
  const timeZone = me?.user.timezone;

  const people = useQuery({
    queryKey: [...directoryKeys.users(), 'home-count'],
    queryFn: ({ signal }) => fetchUsersPage({ limit: PEOPLE_LIMIT }, signal),
  });
  const invitations = useQuery({
    queryKey: directoryKeys.invitations(),
    queryFn: ({ signal }) => fetchPendingInvitations(signal),
    enabled: canInvite,
  });
  const sessions = useQuery({
    queryKey: sessionsKeys.mine(),
    queryFn: ({ signal }) => fetchMySessions(signal),
  });
  const passkeys = useQuery({
    queryKey: passkeysKeys.mine(),
    queryFn: ({ signal }) => fetchMyPasskeys(signal),
  });

  const attention = useMemo(
    () =>
      buildAttention({
        invitations: invitations.data,
        passkeys: passkeys.data,
        sessions: sessions.data,
        now: new Date(),
      }),
    [invitations.data, passkeys.data, sessions.data],
  );
  const attentionLoading =
    (canInvite && invitations.isPending) || passkeys.isPending || sessions.isPending;

  const peopleCount =
    people.data === undefined
      ? ''
      : `${String(people.data.data.length)}${people.data.page.nextCursor !== null ? '+' : ''}`;
  const invitationCounts =
    invitations.data !== undefined ? countInvitations(invitations.data) : undefined;
  const passkeyCount = passkeys.data?.length ?? 0;

  function renderItem(item: AttentionItem): ReactNode {
    switch (item.kind) {
      case 'invitationExpired':
      case 'invitationExpiring': {
        const expired = item.kind === 'invitationExpired';
        const title = t(
          expired ? 'home.attention.invitationExpired' : 'home.attention.invitationExpiring',
          { email: item.email },
        );
        return (
          <AttentionRow
            key={`${item.kind}-${item.id}`}
            tone={expired ? 'danger' : 'warning'}
            icon={expired ? <Mail className="size-5" /> : <Clock className="size-5" />}
            title={title}
            description={
              expired
                ? t('home.attention.invitationExpiredDescription')
                : t('home.attention.invitationExpiringDescription', {
                    date: formatDateTime(item.expiresAt, locale, timeZone),
                  })
            }
            action={
              <Link
                to="/users"
                search={{ view: 'invitations' }}
                className={rowAction}
                aria-label={t('home.attention.actionLabel', {
                  action: t('home.attention.resend'),
                  item: title,
                })}
              >
                {t('home.attention.resend')}
              </Link>
            }
          />
        );
      }
      case 'noPasskey':
        return (
          <AttentionRow
            key="noPasskey"
            tone="warning"
            icon={<AlertTriangle className="size-5" />}
            title={t('home.attention.noPasskey')}
            description={t('home.attention.noPasskeyDescription')}
            action={
              <Link to="/security" className={rowAction}>
                {t('home.attention.register')}
              </Link>
            }
          />
        );
      case 'otherSessions': {
        const title = t('home.attention.otherSessions', { count: item.count });
        return (
          <AttentionRow
            key="otherSessions"
            tone="accent"
            icon={<MonitorSmartphone className="size-5" />}
            title={title}
            description={t('home.attention.otherSessionsDescription')}
            action={
              <Link
                to="/sessions"
                className={rowAction}
                aria-label={t('home.attention.actionLabel', {
                  action: t('home.attention.review'),
                  item: title,
                })}
              >
                {t('home.attention.review')}
              </Link>
            }
          />
        );
      }
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* El h1 nombra la pantalla (igual que el menú); el saludo es su presentación visual. */}
          <h1 className="sr-only">{t('home.title')}</h1>
          <p className="font-heading text-3xl font-bold tracking-tight text-text">
            {t('home.greeting', { name: me?.user.displayName.split(/\s+/)[0] ?? '' })}
          </p>
          {me !== undefined ? (
            <p className="text-sm text-text-muted">
              {t('home.today', {
                date: formatLongDate(new Date(), locale, timeZone),
                rank: t(`rank.${String(me.user.rank)}`),
              })}
            </p>
          ) : null}
        </div>
        <Link to="/users" className={buttonVariants({ variant: 'primary' })}>
          <Users aria-hidden="true" className="size-4" />
          {t('home.goToUsers')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('home.stats.people')}
          value={statValue(people.status, peopleCount)}
          hint={t('home.stats.peopleHint')}
          icon={<Users className="size-5" />}
        />
        {canInvite ? (
          <StatCard
            label={t('home.stats.invitations')}
            value={statValue(invitations.status, String(invitationCounts?.pending ?? 0))}
            hint={
              invitationCounts === undefined || invitationCounts.expired === 0
                ? t('home.stats.invitationsNoneExpired')
                : t('home.stats.invitationsExpired', { count: invitationCounts.expired })
            }
            tone={
              invitationCounts !== undefined && invitationCounts.expired > 0 ? 'danger' : 'accent'
            }
            icon={<Mail className="size-5" />}
          />
        ) : null}
        <StatCard
          label={t('home.stats.sessions')}
          value={statValue(sessions.status, String(sessions.data?.length ?? 0))}
          hint={t('home.stats.sessionsHint')}
          icon={<MonitorSmartphone className="size-5" />}
        />
        <StatCard
          label={t('home.stats.passkeys')}
          value={statValue(passkeys.status, String(passkeyCount))}
          hint={passkeyCount === 0 ? t('home.stats.passkeysNone') : t('home.stats.passkeysHint')}
          tone={passkeys.data !== undefined && passkeyCount === 0 ? 'warning' : 'success'}
          icon={<KeyRound className="size-5" />}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel
          title={t('home.attention.title')}
          aside={
            attention.length > 0 ? (
              <Badge tone="warning">{t('home.attention.count', { count: attention.length })}</Badge>
            ) : null
          }
        >
          {attentionLoading ? (
            <div className="flex flex-col gap-3 px-5 py-6" aria-busy="true">
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
            </div>
          ) : attention.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="size-8 text-success" />}
              title={t('home.attention.empty')}
              description={t('home.attention.emptyDescription')}
            />
          ) : (
            <ul className="divide-y divide-border">{attention.map(renderItem)}</ul>
          )}
        </Panel>

        <Panel title={t('home.shortcuts.title')}>
          <ul className="divide-y divide-border">
            <Shortcut
              to="/users"
              icon={Users}
              title={t('home.shortcuts.users')}
              description={t('home.shortcuts.usersDescription')}
            />
            <Shortcut
              to="/sessions"
              icon={MonitorSmartphone}
              title={t('home.shortcuts.sessions')}
              description={t('home.shortcuts.sessionsDescription')}
            />
            <Shortcut
              to="/security"
              icon={ShieldCheck}
              title={t('home.shortcuts.security')}
              description={t('home.shortcuts.securityDescription')}
            />
            {canManageRoles ? (
              <Shortcut
                to="/roles"
                icon={KeyRound}
                title={t('home.shortcuts.roles')}
                description={t('home.shortcuts.rolesDescription')}
              />
            ) : null}
          </ul>
        </Panel>
      </div>
    </>
  );
}
