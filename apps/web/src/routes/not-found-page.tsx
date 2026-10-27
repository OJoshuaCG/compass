import { EmptyState } from '@iam/ui';
import { useTranslation } from 'react-i18next';

/** No revela si el recurso existe (docs/frontend.md §7.2): mensaje único para 404. */
export function NotFoundPage() {
  const { t } = useTranslation('errors');
  return <EmptyState title={t('NOT_FOUND')} />;
}

/** 404 fuera de cualquier marco (ruta desconocida): aporta su propio `<main>`. */
export function RootNotFound() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <NotFoundPage />
    </main>
  );
}
