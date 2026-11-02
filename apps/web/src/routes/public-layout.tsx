import { Brand, MAIN_CONTENT_CLASS, MAIN_CONTENT_ID, SkipLink } from '@iam/ui';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Año del pie; se calcula una vez al cargar el módulo (el render debe ser puro). */
const YEAR = new Date().getFullYear();

import { LanguageSwitcher } from '../shared/i18n';

/**
 * Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación) como el diseño
 * de Compass: fondo azul marino con degradado y el formulario directo sobre él, sin tarjeta. La clase
 * `theme-auth` redefine los tokens de color solo aquí (ver tokens.css).
 */
export function PublicLayout() {
  const { t } = useTranslation('common');
  return (
    <div className="theme-auth flex min-h-dvh flex-col bg-linear-to-br from-nav to-canvas text-text">
      <SkipLink label={t('nav.skipToContent')} />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <Brand name={t('app.name')} />
        <LanguageSwitcher inverse />
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={`${MAIN_CONTENT_CLASS} mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 text-text`}
      >
        <Outlet />
      </main>
      <footer className="flex flex-col items-center gap-1 px-4 py-6 text-center text-xs text-text-muted">
        <p>{t('publicLayout.auditNote')}</p>
        <p>{t('publicLayout.copyright', { year: YEAR })}</p>
      </footer>
    </div>
  );
}
