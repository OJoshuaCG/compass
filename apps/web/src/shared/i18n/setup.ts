import { DEFAULT_LOCALE, NAMESPACES, resources, type Locale } from '@iam/i18n';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storeLocale } from './locale-storage';

/**
 * Crea una instancia de i18next con los catálogos de `@iam/i18n`. Una instancia por
 * llamada (no la global) para que las pruebas no compartan estado.
 *
 * `keySeparator: false` porque las claves son planas con puntos literales y el código de
 * error de la API es, tal cual, la clave del catálogo `errors`.
 */
export function createI18n(locale: Locale = DEFAULT_LOCALE): I18nInstance {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: ['es-MX', 'en-US'],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    resources,
    keySeparator: false,
    // Los catálogos están empaquetados: la inicialización es síncrona.
    initAsync: false,
    // React ya escapa; evitar doble escape.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = locale;
  instance.on('languageChanged', (next) => {
    document.documentElement.lang = next;
  });
  return instance;
}

/** Cambia el idioma y recuerda la preferencia. */
export async function changeLocale(instance: I18nInstance, locale: Locale): Promise<void> {
  await instance.changeLanguage(locale);
  storeLocale(locale);
}
