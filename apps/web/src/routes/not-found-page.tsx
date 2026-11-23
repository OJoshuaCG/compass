import { EmptyState, MAIN_CONTENT_CLASS, MAIN_CONTENT_ID, SkipLink } from '@iam/ui';
import { useTranslation } from 'react-i18next';

/** No revela si el recurso existe (docs/frontend.md §7.2): mensaje único para 404. */
export function NotFoundPage() {
  const { t } = useTranslation('errors');
  // La 404 no trae otro encabezado: sin este h1 la pantalla queda sin título para un lector de pantalla.
  return <EmptyState title={t('NOT_FOUND')} titleAs="h1" />;
}

/** 404 fuera de cualquier marco (ruta desconocida): aporta su propio `<main>`. */
export function RootNotFound() {
  const { t } = useTranslation('common');
  return (
    <>
      <SkipLink label={t('nav.skipToContent')} />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={`${MAIN_CONTENT_CLASS} mx-auto max-w-xl p-6`}
      >
        <NotFoundPage />
      </main>
    </>
  );
}
