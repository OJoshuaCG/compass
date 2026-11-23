import { LOCALES, isLocale } from '@iam/i18n';
import { cn } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { changeLocale } from './setup';

/**
 * Selector de idioma es-MX / en-US como el diseño de Compass: una píldora con un botón por idioma
 * (ES | EN) y el activo resaltado. Recuerda la elección (ver `locale-storage`).
 *
 * Accesibilidad: es un grupo con nombre ("Idioma") de botones con `aria-pressed`. El texto visible es
 * el código corto; el nombre accesible es el nombre del idioma en su propio idioma, que empieza con
 * ese código (WCAG 2.5.3), y `lang` hace que el lector de pantalla lo pronuncie bien (WCAG 3.1.2).
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const current = isLocale(i18n.language) ? i18n.language : LOCALES[0];
  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex gap-0.5 rounded-full border border-border-strong bg-surface p-0.5"
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        const name = t(`language.${locale}`, { lng: locale });
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-label={name}
            title={name}
            aria-pressed={active}
            onClick={() => {
              if (!active) void changeLocale(i18n, locale);
            }}
            className={cn(
              'h-7 min-w-10 rounded-full px-3 text-sm font-semibold transition-colors duration-fast',
              active ? 'bg-accent-solid text-on-accent' : 'text-text-muted hover:text-text',
            )}
          >
            {/* Código corto derivado del locale (es-MX → ES): no es texto de interfaz. */}
            {locale.slice(0, 2).toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
