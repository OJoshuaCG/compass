import { AppShell, Button, LogOut } from '@iam/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useLogout, useMe } from '../shared/auth';
import { LanguageSwitcher } from '../shared/i18n';

const linkClass =
  'flex min-h-8 items-center rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-raised hover:text-text';
const activeProps = { 'aria-current': 'page', className: 'bg-raised text-text' } as const;

/** Marco de la app autenticada: navegación, cabecera con idioma, usuario y cierre de sesión. */
export function AppLayout() {
  const { t } = useTranslation('common');
  const me = useMe();
  const { logout, pending } = useLogout();
  return (
    <AppShell
      skipLinkLabel={t('nav.skipToContent')}
      header={
        <>
          <span className="font-heading text-lg text-text">{t('app.name')}</span>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            {me !== undefined ? (
              <span className="hidden text-sm text-text-secondary sm:inline">
                {me.user.displayName}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() => {
                void logout();
              }}
            >
              <LogOut aria-hidden="true" className="size-4" />
              {t('actions.logout')}
            </Button>
          </div>
        </>
      }
      sidebar={
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                to="/"
                className={linkClass}
                activeProps={activeProps}
                activeOptions={{ exact: true }}
              >
                {t('nav.home')}
              </Link>
            </li>
            <li>
              <Link to="/users" className={linkClass} activeProps={activeProps}>
                {t('nav.users')}
              </Link>
            </li>
            <li>
              <Link to="/sessions" className={linkClass} activeProps={activeProps}>
                {t('nav.sessions')}
              </Link>
            </li>
            {import.meta.env.DEV ? (
              <li>
                <Link to="/catalog" className={linkClass} activeProps={activeProps}>
                  {t('nav.catalog')}
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
