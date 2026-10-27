import enUSCommon from './locales/en-US/common.json' with { type: 'json' };
import enUSErrors from './locales/en-US/errors.json' with { type: 'json' };
import esMXCommon from './locales/es-MX/common.json' with { type: 'json' };
import esMXErrors from './locales/es-MX/errors.json' with { type: 'json' };

export const LOCALES = ['es-MX', 'en-US'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es-MX';

export const NAMESPACES = ['common', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Catálogos planos: las claves llevan puntos literales ("table.next"), por lo que i18next
 * debe iniciarse con `keySeparator: false`. Así la clave de un error es el propio código
 * de la API, sin transformaciones que puedan divergir del backend.
 */
export const resources = {
  'es-MX': { common: esMXCommon, errors: esMXErrors },
  'en-US': { common: enUSCommon, errors: enUSErrors },
} as const satisfies Record<Locale, Record<Namespace, Record<string, string>>>;

export type CommonKey = keyof (typeof resources)['es-MX']['common'];
export type ErrorsKey = keyof (typeof resources)['es-MX']['errors'];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Convierte un idioma del navegador ("es", "es-AR", "en-GB") al idioma soportado más cercano.
 * Solo se usa en el primer acceso; después manda la preferencia guardada.
 */
export function resolveLocale(input: string | undefined | null): Locale {
  if (input === undefined || input === null) return DEFAULT_LOCALE;
  if (isLocale(input)) return input;
  const language = input.toLowerCase().split('-')[0];
  return language === 'en' ? 'en-US' : DEFAULT_LOCALE;
}

/** Clave i18n (namespace `errors`) de un código de error de la API. */
export function errorMessageKey(code: string): string {
  return code;
}

/**
 * Resuelve la clave de un código de error: si el catálogo no lo conoce devuelve `generic`,
 * para que la UI nunca muestre una clave cruda. El llamador debe registrar el código ausente.
 */
export function knownErrorKey(code: string): { key: string; known: boolean } {
  const known = code in resources[DEFAULT_LOCALE].errors && code !== 'generic';
  return known ? { key: errorMessageKey(code), known } : { key: 'generic', known };
}
