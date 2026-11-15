import {
  AlertTriangle,
  AppShell,
  ArrowRightLeft,
  Bell,
  BrandMark,
  House,
  IconButton,
  Inbox,
  KeyRound,
  Layers,
  LayoutGrid,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  NavGroup,
  navItemClass,
  navItemIconClass,
  ShieldCheck,
  SIDEBAR_ID,
  SlidersHorizontal,
  UserCog,
  UserMenu,
  Users,
  UsersRound,
} from '@iam/ui';
import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { RankBadge } from '../features/directory';
import { useLogout, useMe, usePermission } from '../shared/auth';
import { LanguageSwitcher } from '../shared/i18n';
import { useSidebarVisibility } from '../shared/layout';
import { ThemeSwitcher } from '../shared/theme';

// El estado activo se dibuja desde `aria-current` (ver `navItemClass`), que el enrutador fija.
const activeProps = { 'aria-current': 'page' } as const;

type NavLinkProps = {
  to: string;
  icon: ReactNode;
  label: string;
  exact?: boolean;
  /** Se llama al activar el enlace; el menú lo usa para plegarse en móvil. */
  onNavigate: () => void;
};

/** Enlace del menú lateral: el `Link` del enrutador con las clases compartidas de `NavItem`. */
function NavLink({ to, icon, label, exact = false, onNavigate }: NavLinkProps) {
  return (
    <li>
      <Link
        to={to}
        className={navItemClass}
        activeProps={activeProps}
        activeOptions={{ exact }}
        onClick={onNavigate}
      >
        <span aria-hidden="true" className={navItemIconClass}>
          {icon}
        </span>
        {label}
      </Link>
    </li>
  );
}

/** Rango máximo (número) que ve el enlace de la transferencia de la Raíz: la Raíz y los Administradores. */
const MAX_RANK_TO_SEE_ROOT_TRANSFER = 1;

/** Marco de la app autenticada: barra superior, navegación agrupada y contenido. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const me = useMe();
  const canManageRoles = usePermission('role.manage');
  // Solo comodidad: el enlace se ofrece a quien puede leer códigos; el servidor decide siempre.
  const canReadInboundCodes = usePermission('inbound.read_codes');
  // Solo comodidad: el enlace de configurar fuentes se ofrece con `inbound.configure`; el servidor decide.
  const canConfigureInbound = usePermission('inbound.configure');
  // Solo comodidad: el enlace de salud de credenciales se ofrece con `credential.view_health`; el servidor decide.
  const canViewCredentialHealth = usePermission('credential.view_health');
  // Solo comodidad: el enlace de alertas de infraestructura se ofrece con `alerts.infra.manage`; el servidor decide.
  const canManageInfraAlerts = usePermission('alerts.infra.manage');
  // Solo comodidad: la transferencia de la Raíz la ven la Raíz y los Administradores; el servidor decide.
  const canSeeRootTransfer = me !== undefined && me.user.rank <= MAX_RANK_TO_SEE_ROOT_TRANSFER;
  const { logout, pending } = useLogout();
  const sidebarState = useSidebarVisibility(me?.user.id);
  const sidebarVisible: boolean = sidebarState.visible;
  const closeSidebar: () => void = sidebarState.close;
  const showCatalog: boolean = import.meta.env.DEV;
  // El grupo Acceso se oculta entero cuando ninguno de sus enlaces aplica a la persona.
  const showAccessGroup: boolean =
    canManageRoles || canManageInfraAlerts || canSeeRootTransfer || showCatalog;
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
            <NavLink
              onNavigate={closeSidebar}
              to="/"
              exact
              icon={<House className="size-5" />}
              label={t('nav.home')}
            />
            <NavLink
              onNavigate={closeSidebar}
              to="/users"
              icon={<Users className="size-5" />}
              label={t('nav.users')}
            />
            {/* Sin permiso previo: la lista ya llega acotada por el servidor a lo que la persona ve. */}
            <NavLink
              onNavigate={closeSidebar}
              to="/groups"
              icon={<UsersRound className="size-5" />}
              label={t('nav.groups')}
            />
            <NavLink
              onNavigate={closeSidebar}
              to="/sessions"
              icon={<Monitor className="size-5" />}
              label={t('nav.sessions')}
            />
            <NavLink
              onNavigate={closeSidebar}
              to="/security"
              icon={<ShieldCheck className="size-5" />}
              label={t('nav.security')}
            />
          </NavGroup>
          <NavGroup label={t('nav.group.vault')}>
            <NavLink
              onNavigate={closeSidebar}
              to="/accounts"
              icon={<KeyRound className="size-5" />}
              label={t('nav.accounts')}
            />
            {canReadInboundCodes ? (
              // Exacto: «Fuentes» y «Vistas» cuelgan de /inbound y no deben marcar también «Códigos».
              <NavLink
                onNavigate={closeSidebar}
                to="/inbound"
                exact
                icon={<Inbox className="size-5" />}
                label={t('nav.inbound')}
              />
            ) : null}
            {canConfigureInbound ? (
              <>
                <NavLink
                  onNavigate={closeSidebar}
                  to="/inbound/sources"
                  icon={<Layers className="size-5" />}
                  label={t('nav.inboundSources')}
                />
                <NavLink
                  onNavigate={closeSidebar}
                  to="/inbound/view-settings"
                  icon={<SlidersHorizontal className="size-5" />}
                  label={t('nav.inboundViewSettings')}
                />
              </>
            ) : null}
            {canViewCredentialHealth ? (
              <NavLink
                onNavigate={closeSidebar}
                to="/credential-health"
                icon={<AlertTriangle className="size-5" />}
                label={t('nav.credentialHealth')}
              />
            ) : null}
          </NavGroup>
          {showAccessGroup ? (
            <NavGroup label={t('nav.group.access')}>
              {canManageRoles ? (
                <NavLink
                  onNavigate={closeSidebar}
                  to="/roles"
                  icon={<UserCog className="size-5" />}
                  label={t('nav.roles')}
                />
              ) : null}
              {canManageInfraAlerts ? (
                <NavLink
                  onNavigate={closeSidebar}
                  to="/alerts"
                  icon={<Bell className="size-5" />}
                  label={t('nav.alerts')}
                />
              ) : null}
              {canSeeRootTransfer ? (
                <NavLink
                  onNavigate={closeSidebar}
                  to="/root-transfer"
                  icon={<ArrowRightLeft className="size-5" />}
                  label={t('nav.rootTransfer')}
                />
              ) : null}
              {showCatalog ? (
                <NavLink
                  onNavigate={closeSidebar}
                  to="/catalog"
                  icon={<LayoutGrid className="size-5" />}
                  label={t('nav.catalog')}
                />
              ) : null}
            </NavGroup>
          ) : null}
        </nav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
