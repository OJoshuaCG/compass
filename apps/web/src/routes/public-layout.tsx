import { Brand } from '@iam/ui';
import { Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../shared/i18n';

/**
 * Marco de las pantallas previas a la sesión (login, MFA, enrolamiento, invitación): fondo azul
 * marino de la marca y el formulario en una tarjeta clara centrada.
 */
export function PublicLayout() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-dvh flex-col bg-nav text-nav-text [&_header_:focus-visible]:outline-nav-focus">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <Brand name={t('app.name')} />
        <LanguageSwitcher inverse />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 text-text">
        <Outlet />
      </main>
    </div>
  );
}
