import { LOCALES, isLocale } from '@iam/i18n';
import { NativeSelect } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { changeLocale } from './setup';

/** Selector de idioma es-MX / en-US. Recuerda la elección (ver `locale-storage`). */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const id = useId();
  const current = isLocale(i18n.language) ? i18n.language : LOCALES[0];
  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <label htmlFor={id}>{t('language.label')}</label>
      <NativeSelect
        id={id}
        size="sm"
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) void changeLocale(i18n, next);
        }}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`language.${locale}`)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
