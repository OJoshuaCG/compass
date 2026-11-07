import { BrandMark, MAIN_CONTENT_CLASS, MAIN_CONTENT_ID, SkipLink } from '@iam/ui';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';
import { ThemeSwitcher } from '../shared/theme';

/** Año del pie; se calcula una vez al cargar el módulo (el render debe ser puro). */
const YEAR = new Date().getFullYear();

/**
 * Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación) con la barra
 * superior de cristal de ADR 0049: marca, idioma y tema. El formulario va directo sobre el fondo.
 */
export function PublicLayout() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-dvh flex-col text-text">
      <SkipLink label={t('nav.skipToContent')} />
      <header className="glass-bar sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2 md:px-5">
        <span className="inline-flex items-center gap-2.5 font-heading text-lg font-semibold text-text">
          <BrandMark />
          {t('app.name')}
        </span>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={`${MAIN_CONTENT_CLASS} mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8`}
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
