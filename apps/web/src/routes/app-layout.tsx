import {
  AppShell,
  BrandMark,
  House,
  IconButton,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  NavGroup,
  navItemClass,
  navItemIconClass,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SIDEBAR_ID,
  UserMenu,
  Users,
  type LucideIcon,
} from '@iam/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { RankBadge } from '../features/directory';
import { useLogout, useMe, usePermission } from '../shared/auth';
import { LanguageSwitcher } from '../shared/i18n';
import { useSidebarVisibility } from '../shared/layout';
import { ThemeSwitcher } from '../shared/theme';

import { SectionNav, type SectionLink } from './section-nav';

/** La ruta actual cae en `path` o en alguna de sus subrutas (`/accounts/:id/...`). */
const isWithin = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/**
 * Entrada del menú lateral con las clases de `NavItem` (ADR 0049). `paths` son las rutas que la
 * dejan marcada: una sección (Personas, Configuración) agrupa varias pantallas y sigue activa en
 * cualquiera de ellas. El aspecto activo sale de `aria-current`, como en `navItemClass`.
 */
function NavLink({
  to,
  paths = [to],
  icon: Icon,
  exact,
  children,
}: {
  to: '/' | '/users' | '/security' | '/accounts' | '/catalog' | '/inbound' | '/inbound/sources';
  paths?: readonly string[];
  icon: LucideIcon;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = exact === true ? pathname === to : paths.some((path) => isWithin(pathname, path));
  return (
    <li>
      <Link to={to} className={navItemClass} aria-current={active ? 'page' : undefined}>
        <span aria-hidden="true" className={navItemIconClass}>
          <Icon className="size-5" />
        </span>
        {children}
      </Link>
    </li>
  );
}

const VAULT_PATHS = ['/accounts', '/vault'] as const;
const PEOPLE_PATHS = ['/users', '/roles'] as const;
const SETTINGS_PATHS = ['/security', '/sessions', '/audit', '/alerts'] as const;
const INBOUND_PATHS = ['/inbound'] as const;

/** Marco de la app autenticada (ADR 0049): barra superior de cristal y menú lateral por grupos. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const me = useMe();
  const canManageRoles = usePermission('role.manage');
  const canReadAllAudit = usePermission('audit.read_all');
  const canReadScopeAudit = usePermission('audit.read_scope');
  const canReadAudit = canReadAllAudit || canReadScopeAudit;
  // Solo comodidad: el enlace se ofrece a quien puede leer códigos; el servidor decide siempre.
  const canReadInboundCodes = usePermission('inbound.read_codes');
  // Solo comodidad: el enlace de configurar fuentes se ofrece con `inbound.configure`; el servidor decide.
  const canConfigureInbound = usePermission('inbound.configure');
  // Solo comodidad: el enlace de alertas de infraestructura se ofrece con `alerts.infra.manage`; el servidor decide.
  const canManageInfraAlerts = usePermission('alerts.infra.manage');
  const { logout, pending } = useLogout();
  const sidebarState = useSidebarVisibility(me?.user.id);
  const sidebarVisible: boolean = sidebarState.visible;
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // Pestañas de cada sección, como en el diseño: Personas (usuarios y roles) y Configuración
  // (seguridad y sesiones). Una sección con una sola pantalla no muestra pestañas.
  const peopleLinks: SectionLink[] = [
    { to: '/users', label: t('nav.users') },
    ...(canManageRoles ? [{ to: '/roles' as const, label: t('nav.roles') }] : []),
  ];
  const settingsLinks: SectionLink[] = [
    { to: '/security', label: t('nav.security') },
    { to: '/sessions', label: t('nav.sessions') },
    // Vista previa con eventos ficticios: solo en desarrollo hasta que exista la lectura (R1).
    ...(import.meta.env.DEV && canReadAudit
      ? [{ to: '/audit' as const, label: t('nav.audit') }]
      : []),
    ...(canManageInfraAlerts ? [{ to: '/alerts' as const, label: t('nav.alerts') }] : []),
  ];
  // Códigos de acceso: leerlos y configurar sus fuentes y vistas son pantallas hermanas.
  const inboundLinks: SectionLink[] = [
    ...(canReadInboundCodes
      ? [{ to: '/inbound' as const, label: t('nav.inbound'), exact: true }]
      : []),
    ...(canConfigureInbound
      ? [
          { to: '/inbound/sources' as const, label: t('nav.inboundSources') },
          { to: '/inbound/view-settings' as const, label: t('nav.inboundViewSettings') },
        ]
      : []),
  ];
  const section = PEOPLE_PATHS.some((path) => isWithin(pathname, path))
    ? { label: t('nav.sectionsOf', { section: t('nav.people') }), links: peopleLinks }
    : SETTINGS_PATHS.some((path) => isWithin(pathname, path))
      ? { label: t('nav.sectionsOf', { section: t('nav.settings') }), links: settingsLinks }
      : INBOUND_PATHS.some((path) => isWithin(pathname, path))
        ? { label: t('nav.sectionsOf', { section: t('nav.codes') }), links: inboundLinks }
        : undefined;

  return (
    <AppShell
      skipLinkLabel={t('nav.skipToContent')}
      sidebarHidden={!sidebarVisible}
      header={
        <>
          <div className="flex items-center gap-2">
            <IconButton
              variant="ghost"
              size="md"
              label={sidebarVisible ? t('nav.hideMenu') : t('nav.showMenu')}
              icon={
                sidebarVisible ? (
                  <PanelLeftClose className="size-5" />
                ) : (
                  <PanelLeftOpen className="size-5" />
                )
              }
              aria-expanded={sidebarVisible}
              aria-controls={SIDEBAR_ID}
              onClick={sidebarState.toggle}
            />
            <span className="inline-flex items-center gap-2.5 font-heading text-lg font-semibold text-text">
              <BrandMark />
              {t('app.name')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
            {me !== undefined ? (
              <UserMenu
                name={me.user.displayName}
                details={
                  <RankBadge rank={me.user.rank} label={t(`rank.${String(me.user.rank)}`)} />
                }
                actions={[
                  {
                    id: 'logout',
                    label: t('actions.logout'),
                    icon: <LogOut className="size-4" />,
                    pending,
                    onSelect: () => {
                      void logout();
                    },
                  },
                ]}
              />
            ) : null}
          </div>
        </>
      }
      sidebar={
        <nav aria-label={t('nav.label')} className="flex flex-col gap-5">
          <NavGroup label={t('nav.group.workspace')}>
            <NavLink to="/" exact icon={House}>
              {t('nav.home')}
            </NavLink>
            <NavLink to="/users" paths={PEOPLE_PATHS} icon={Users}>
              {t('nav.people')}
            </NavLink>
          </NavGroup>
          <NavGroup label={t('nav.group.vault')}>
            {/* La vista previa del diseño (/vault, solo en desarrollo) no tiene entrada propia. */}
            <NavLink to="/accounts" paths={VAULT_PATHS} icon={Lock}>
              {t('nav.vault')}
            </NavLink>
            {canReadInboundCodes || canConfigureInbound ? (
              <NavLink
                to={canReadInboundCodes ? '/inbound' : '/inbound/sources'}
                paths={INBOUND_PATHS}
                icon={Mail}
              >
                {t('nav.codes')}
              </NavLink>
            ) : null}
          </NavGroup>
          <NavGroup label={t('nav.group.access')}>
            <NavLink to="/security" paths={SETTINGS_PATHS} icon={Settings}>
              {t('nav.settings')}
            </NavLink>
            {import.meta.env.DEV ? (
              <NavLink to="/catalog" icon={LayoutGrid}>
                {t('nav.catalog')}
              </NavLink>
            ) : null}
          </NavGroup>
        </nav>
      }
    >
      {/* Las pestañas de la sección van sobre el contenido: la barra superior es global. */}
      {section !== undefined && section.links.length > 1 ? (
        <SectionNav label={section.label} links={section.links} />
      ) : null}
      <Outlet />
    </AppShell>
  );
}
