import { MAIN_CONTENT_CLASS, MAIN_CONTENT_ID, SkipLink } from '@iam/ui';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';

/** Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación). */
export function PublicLayout() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink label={t('nav.skipToContent')} />
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="font-heading text-lg text-text">{t('app.name')}</span>
        <LanguageSwitcher />
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
