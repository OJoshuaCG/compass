import { BrandMark, MAIN_CONTENT_CLASS, MAIN_CONTENT_ID, SkipLink } from '@iam/ui';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';
import { ThemeSwitcher } from '../shared/theme';

/** Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación). */
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
        className={`${MAIN_CONTENT_CLASS} mx-auto w-full max-w-md flex-1 px-4 py-8`}
      >
        <Outlet />
      </main>
    </div>
  );
}
