import {
  AppShell,
  Brand,
  House,
  IconButton,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  Users,
  type LucideIcon,
} from '@iam/ui';
import { Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useLogout, useMe, usePermission } from '../shared/auth';
import { LanguageSwitcher } from '../shared/i18n';

const linkClass =
  'flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-nav-text-muted hover:bg-nav-raised hover:text-nav-text';
const activeProps = {
  'aria-current': 'page',
  className: 'bg-nav-raised font-semibold text-nav-text',
} as const;

function NavItem({
  to,
  icon: Icon,
  exact,
  children,
}: {
  to: '/' | '/vault' | '/users' | '/sessions' | '/security' | '/roles' | '/catalog';
  icon: LucideIcon;
  exact?: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={linkClass}
        activeProps={activeProps}
        activeOptions={{ exact: exact === true }}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        {children}
      </Link>
    </li>
  );
}

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
  const { logout, pending } = useLogout();
  return (
    <AppShell
      skipLinkLabel={t('nav.skipToContent')}
      brand={<Brand name={t('app.name')} />}
      header={<LanguageSwitcher />}
      sidebar={
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-col gap-0.5">
            <NavItem to="/" icon={House} exact>
              {t('nav.home')}
            </NavItem>
            {/* Vista previa con datos ficticios: solo en desarrollo hasta la fase 1b. */}
            {import.meta.env.DEV ? (
              <NavItem to="/vault" icon={Lock}>
                {t('nav.vaultPreview')}
              </NavItem>
            ) : null}
            <NavItem to="/users" icon={Users}>
              {t('nav.users')}
            </NavItem>
            <NavItem to="/sessions" icon={MonitorSmartphone}>
              {t('nav.sessions')}
            </NavItem>
            <NavItem to="/security" icon={ShieldCheck}>
              {t('nav.security')}
            </NavItem>
            {canManageRoles ? (
              <NavItem to="/roles" icon={KeyRound}>
                {t('nav.roles')}
              </NavItem>
            ) : null}
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
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {me.user.displayName}
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
