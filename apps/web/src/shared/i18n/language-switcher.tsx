import { LOCALES, isLocale, type Locale } from '@iam/i18n';
import { IconButton } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { changeLocale } from './setup';

/** "es-MX" -> "ES": el código ISO 639-1 del idioma, que es lo único que cabe en el botón. */
export function languageCode(locale: Locale): string {
  const [languageSubtag] = locale.split('-');
  return (languageSubtag ?? locale).toUpperCase();
}

/** Idioma que sigue al actual en `LOCALES`; tras el último se vuelve al primero. */
function nextLocaleAfter(current: Locale): Locale {
  const currentIndex: number = LOCALES.indexOf(current);
  const nextIndex: number = (currentIndex + 1) % LOCALES.length;
  return LOCALES[nextIndex] ?? LOCALES[0];
}

/**
 * Botón compacto de la barra que alterna el idioma. Muestra el código del idioma ACTIVO (ES / EN),
 * con el mismo tamaño que el botón de tema; su nombre accesible dice a cuál cambia. Recuerda la
 * elección (ver `locale-storage`).
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const current: Locale = isLocale(i18n.language) ? i18n.language : LOCALES[0];
  const next: Locale = nextLocaleAfter(current);
  // El nombre del idioma destino se pinta en su propio idioma, como en los catálogos.
  const label: string = t('language.switchTo', {
    language: t(`language.${next}`, { lng: next }),
  });
  return (
    <IconButton
      variant="secondary"
      size="md"
      label={label}
      // El código es del idioma activo; `lang` evita que el lector lo pronuncie con otra voz (WCAG 3.1.2).
      icon={
        <span lang={current} className="text-xs font-semibold tracking-wide">
          {languageCode(current)}
        </span>
      }
      onClick={() => {
        void changeLocale(i18n, next);
      }}
    />
  );
}
