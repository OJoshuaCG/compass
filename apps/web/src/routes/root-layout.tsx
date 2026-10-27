import { AppShell } from '@iam/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';

const linkClass =
  'flex min-h-8 items-center rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-raised hover:text-text';

/** Marco de la app: navegación, cabecera con selector de idioma y contenido. */
export function RootLayout() {
  const { t } = useTranslation('common');
  return (
    <AppShell
      skipLinkLabel={t('nav.skipToContent')}
      header={
        <>
          <span className="font-heading text-lg text-text">{t('app.name')}</span>
          <LanguageSwitcher />
        </>
      }
      sidebar={
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                to="/"
                className={linkClass}
                activeProps={{ 'aria-current': 'page', className: 'bg-raised text-text' }}
                activeOptions={{ exact: true }}
              >
                {t('nav.home')}
              </Link>
            </li>
            {import.meta.env.DEV ? (
              <li>
                <Link
                  to="/catalog"
                  className={linkClass}
                  activeProps={{ 'aria-current': 'page', className: 'bg-raised text-text' }}
                >
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
