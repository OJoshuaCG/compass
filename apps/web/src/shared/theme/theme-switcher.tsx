import { IconButton, Moon, Sun } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { applyTheme, readAppliedTheme } from './theme';
import { storeTheme, type Theme } from './theme-storage';

/** Botón de la barra superior que alterna entre el tema oscuro y el claro y recuerda la elección. */
export function ThemeSwitcher() {
  const { t } = useTranslation('common');
  const [theme, setTheme] = useState<Theme>(() => readAppliedTheme());
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  // El nombre accesible dice a qué tema se pasa, no en cuál se está.
  const label: string = nextTheme === 'light' ? t('theme.switchToLight') : t('theme.switchToDark');
  const icon = theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />;
  return (
    <IconButton
      variant="secondary"
      size="md"
      label={label}
      icon={icon}
      onClick={() => {
        applyTheme(nextTheme);
        storeTheme(nextTheme);
        setTheme(nextTheme);
      }}
    />
  );
}
