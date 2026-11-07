import {
  AppShell,
  Brand,
  cn,
  House,
  IconButton,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SIDEBAR_ID,
  Users,
  type LucideIcon,
} from '@iam/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLogout, useMe, usePermission } from '../shared/auth';
import { LanguageSwitcher } from '../shared/i18n';
import { useSidebarVisibility } from '../shared/layout';

import { SectionNav, type SectionLink } from './section-nav';

const linkClass =
  'flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-nav-text-muted hover:bg-nav-raised hover:text-nav-text';
const activeClass = 'bg-nav-raised font-semibold text-nav-text';

/** La ruta actual cae en `path` o en alguna de sus subrutas (`/accounts/:id/...`). */
const isWithin = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/**
 * Entrada del menú principal. `paths` son las rutas que la dejan marcada: una sección del diseño
 * (Personas, Configuración) agrupa varias pantallas y sigue activa en cualquiera de ellas.
 */
function NavItem({
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
      <Link
        to={to}
        className={cn(linkClass, active && activeClass)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        {children}
      </Link>
    </li>
  );
}

const VAULT_PATHS = ['/accounts', '/vault'] as const;
const PEOPLE_PATHS = ['/users', '/roles'] as const;
const SETTINGS_PATHS = ['/security', '/sessions', '/audit', '/alerts'] as const;
const INBOUND_PATHS = ['/inbound'] as const;

/** Iniciales para el avatar: primera letra de las dos primeras palabras del nombre. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** Marco de la app autenticada: barra lateral con navegación y persona, barra superior con idioma. */
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
      brand={<Brand name={t('app.name')} />}
      header={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
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
            {section !== undefined && section.links.length > 1 ? (
              <SectionNav label={section.label} links={section.links} />
            ) : null}
          </div>
          <LanguageSwitcher />
        </div>
      }
      sidebar={
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-col gap-0.5">
            <NavItem to="/" icon={House} exact>
              {t('nav.home')}
            </NavItem>
            {/* La vista previa del diseño (/vault, solo en desarrollo) no tiene entrada propia. */}
            <NavItem to="/accounts" paths={VAULT_PATHS} icon={Lock}>
              {t('nav.vault')}
            </NavItem>
            <NavItem to="/users" paths={PEOPLE_PATHS} icon={Users}>
              {t('nav.people')}
            </NavItem>
            {canReadInboundCodes || canConfigureInbound ? (
              <NavItem
                to={canReadInboundCodes ? '/inbound' : '/inbound/sources'}
                paths={INBOUND_PATHS}
                icon={Mail}
              >
                {t('nav.codes')}
              </NavItem>
            ) : null}
            <NavItem to="/security" paths={SETTINGS_PATHS} icon={Settings}>
              {t('nav.settings')}
            </NavItem>
            {import.meta.env.DEV ? (
              <NavItem to="/catalog" icon={LayoutGrid}>
                {t('nav.catalog')}
              </NavItem>
            ) : null}
          </ul>
        </nav>
      }
      sidebarFooter={
        <div className="flex items-center gap-3 px-1">
          {me !== undefined ? (
            <>
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nav-raised text-sm font-bold"
              >
                {initials(me.user.displayName)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{me.user.displayName}</span>
                <span className="truncate text-xs text-nav-text-muted">
                  {t(`rank.${String(me.user.rank)}`)}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1" />
          )}
          <IconButton
            label={t('actions.logout')}
            title={t('actions.logout')}
            icon={<LogOut className="size-5" />}
            disabled={pending}
            aria-busy={pending}
            className="text-nav-text-muted hover:bg-nav-raised hover:text-nav-text active:bg-nav-raised"
            onClick={() => {
              void logout();
            }}
          />
        </div>
      }
    >
      <Outlet />
    </AppShell>
  );
}
