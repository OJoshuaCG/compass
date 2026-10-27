import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';

/** Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación). */
export function PublicLayout() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="font-heading text-lg text-text">{t('app.name')}</span>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
