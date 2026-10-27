import { lazyCatalogLoaders, type LazyNamespace } from '@iam/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Descarga un catálogo de textos fuera del JavaScript inicial (`directory`, `sessions`) la primera
 * vez que una pantalla lo necesita y lo registra en los dos idiomas, para que cambiar de idioma no
 * vuelva a pedirlo. Devuelve `true` cuando los textos ya están disponibles: hasta entonces la
 * pantalla no debe pintar textos (saldrían como claves).
 *
 * Se importa por su ruta y no por el índice de `shared/i18n`: el índice lo carga el arranque y el
 * empaquetador arrastraría este hook al JavaScript inicial.
 */
export function useLazyCatalog(namespace: LazyNamespace): boolean {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(() => i18n.hasResourceBundle(i18n.language, namespace));
  useEffect(() => {
    if (ready) return;
    let active = true;
    void lazyCatalogLoaders[namespace]().then((catalog) => {
      for (const [locale, bundle] of Object.entries(catalog)) {
        i18n.addResourceBundle(locale, namespace, bundle, true, true);
      }
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [i18n, namespace, ready]);
  return ready;
}
