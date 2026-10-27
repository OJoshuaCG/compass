import { StrengthMeter } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { estimatePasswordStrength } from '../model/password-strength';

/**
 * Medidor de fortaleza de la contraseña. Se calcula en el navegador con una función pura: la
 * contraseña no se envía a ningún tercero (docs/frontend.md §8). No se muestra con el campo vacío.
 */
export function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation('auth');
  if (password === '') return null;
  const level = estimatePasswordStrength(password);
  return (
    <div className="flex flex-col gap-1">
      <StrengthMeter
        level={level}
        label={t('strength.label')}
        levelText={t(`strength.${String(level)}`)}
      />
      <p className="text-xs text-text-muted">{t('strength.privacy')}</p>
    </div>
  );
}
