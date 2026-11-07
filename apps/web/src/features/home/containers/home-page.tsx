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
  Lock,
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
import { directoryKeys, fetchPendingInvitationsPage, fetchUsersPage } from '../../directory';
import { fetchMyPasskeysPage, passkeysKeys } from '../../security';
import { fetchMySessionsPage, sessionsKeys } from '../../sessions';
import { fetchInventoryCount, fetchManagedCount, homeKeys } from '../api/home-api';
import { buildAttention, countInvitations, type AttentionItem } from '../model/attention';
import type { SummaryCount } from '../model/summary-count';
import { AttentionRow } from '../ui/attention-row';

/** Cada resumen se acota a una página (el máximo del servidor); en personas, más allá se muestra "100+". */
const SUMMARY_LIMIT = 100;

const rowAction = buttonVariants({ variant: 'secondary', size: 'sm' });

/** Cifra de una tarjeta: `undefined` mientras carga, guion si falló (la pantalla no se rompe). */
function statValue(status: 'pending' | 'error' | 'success', value: string): string | undefined {
  if (status === 'pending') return undefined;
  return status === 'error' ? '—' : value;
}

/**
 * Cifra exacta de un conteo (regla de main: nunca una aproximación). Si hay más filas de las que
 * caben en una consulta, se muestra guion y la pista lo explica.
 */
function exactValue(
  status: 'pending' | 'error' | 'success',
  count: SummaryCount | undefined,
  locale: string,
): string | undefined {
  if (status === 'pending') return undefined;
  if (status === 'error' || count?.kind !== 'exact') return '—';
  return new Intl.NumberFormat(locale).format(count.value);
}

/** Pista de una cifra exacta: vacía, no disponible o la descripción normal. */
function exactHint(
  count: SummaryCount | undefined,
  texts: { normal: string; empty: string; unavailable: string },
): string {
  if (count?.kind === 'unavailable') return texts.unavailable;
  if (count?.kind === 'exact' && count.value === 0) return texts.empty;
  return texts.normal;
}

/**
 * Brújula decorativa del encabezado, la de main (ADR 0049): aguja norte en el acento. La aguja
 * oscila al abrir el Inicio hasta asentarse y luego deriva unos grados, como una brújula de verdad
 * (`animate-compass-needle` en tokens.css; queda quieta con «reducir movimiento»). Es adorno puro:
 * oculta para lectores de pantalla y solo usa tokens vía `currentColor`.
 */
function CompassArt() {
  return (
    <svg
      viewBox="0 0 160 160"
      width="136"
      height="136"
      aria-hidden="true"
      focusable="false"
      className="hidden shrink-0 text-text-muted sm:block"
    >
      <circle cx="80" cy="80" r="74" fill="none" stroke="currentColor" opacity=".4" />
      <circle
        cx="80"
        cy="80"
        r="66"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeDasharray="1 7.64"
        opacity=".55"
      />
      <circle cx="80" cy="80" r="46" fill="none" stroke="currentColor" opacity=".4" />
      {/* El giro lo da la animación (termina en 38°): por eso no lleva `transform` propio. */}
      <g className="animate-compass-needle origin-center transform-view">
        <path d="M80 28l9 52H71z" className="fill-accent" />
        <path d="M80 132l9-52H71z" fill="currentColor" opacity=".5" />
      </g>
      <circle cx="80" cy="80" r="4.5" className="fill-canvas" stroke="currentColor" />
    </svg>
  );
}

function Shortcut({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: '/users' | '/sessions' | '/security' | '/roles' | '/accounts';
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
  // Solo comodidad: la cifra del inventario se oculta sin su permiso; el servidor decide siempre.
  const canReadInventory = usePermission('vault.inventory.read');
  const locale = i18n.language;
  const timeZone = me?.user.timezone;

  const people = useQuery({
    queryKey: [...directoryKeys.users(), 'home-count'],
    queryFn: ({ signal }) => fetchUsersPage({ limit: SUMMARY_LIMIT }, signal),
  });
  // Las listas ahora se paginan en el servidor: el Inicio resume solo la primera página (máximo
  // permitido) con claves propias, para no mezclar su forma con la caché de las tablas.
  const invitations = useQuery({
    queryKey: [...directoryKeys.invitations(), 'home'],
    queryFn: ({ signal }) => fetchPendingInvitationsPage({ limit: SUMMARY_LIMIT }, signal),
    select: (page) => page.data,
    enabled: canInvite,
  });
  const sessions = useQuery({
    queryKey: [...sessionsKeys.mine(), 'home'],
    queryFn: ({ signal }) => fetchMySessionsPage({ limit: SUMMARY_LIMIT }, signal),
    select: (page) => page.data,
  });
  // Cifras traídas de main: el equipo de quien consulta y el inventario. Cambian desde otros
  // dispositivos, así que siempre se recargan.
  const team = useQuery({
    queryKey: homeKeys.managedCount(),
    queryFn: ({ signal }) => fetchManagedCount(signal),
    staleTime: 0,
  });
  const inventory = useQuery({
    queryKey: homeKeys.inventoryCount(),
    queryFn: ({ signal }) => fetchInventoryCount(signal),
    staleTime: 0,
    enabled: canReadInventory,
  });
  const passkeys = useQuery({
    queryKey: [...passkeysKeys.mine(), 'home'],
    queryFn: ({ signal }) => fetchMyPasskeysPage({ limit: SUMMARY_LIMIT }, signal),
    select: (page) => page.data,
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs font-medium tracking-widest text-text-muted uppercase">
            {t('nav.group.workspace')}
          </p>
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
        <CompassArt />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={t('home.stats.team')}
          value={exactValue(team.status, team.data, locale)}
          hint={exactHint(team.data, {
            normal: t('home.stats.teamHint'),
            empty: t('home.stats.teamNone'),
            unavailable: t('home.stats.unavailableHint'),
          })}
          icon={<Users className="size-5" />}
        />
        {canReadInventory ? (
          <StatCard
            label={t('home.stats.inventory')}
            value={exactValue(inventory.status, inventory.data, locale)}
            hint={exactHint(inventory.data, {
              normal: t('home.stats.inventoryHint'),
              empty: t('home.stats.inventoryNone'),
              unavailable: t('home.stats.unavailableHint'),
            })}
            icon={<Lock className="size-5" />}
          />
        ) : null}
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
              to="/accounts"
              icon={Lock}
              title={t('home.shortcuts.accounts')}
              description={t('home.shortcuts.accountsDescription')}
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
