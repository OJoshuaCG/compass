import { useTranslation } from 'react-i18next';

type FieldErrorLike = { type?: string | number | undefined; message?: string | undefined };

/**
 * Traduce un error de validación de formulario. Los mensajes de Zod vienen en inglés, así que se
 * traducen por el tipo de incidencia (`too_small`, `invalid_format`...) y el campo; los errores
 * del servidor (`type: 'server'`) ya llegan traducidos. Un campo vacío siempre es "obligatorio".
 */
export function useValidationMessage(): (
  error: FieldErrorLike | undefined,
  context: { field: string; empty?: boolean },
) => string | undefined {
  const { t } = useTranslation('common');
  return (error, { field, empty = false }) => {
    if (error === undefined) return undefined;
    if (error.type === 'server' && error.message !== undefined) return error.message;
    if (empty) return t('validation.required');
    switch (error.type) {
      case 'too_small':
        if (field === 'recoveryCode') return t('validation.recoveryCode');
        return field === 'password'
          ? t('validation.passwordTooShort', { min: 12 })
          : t('validation.required');
      case 'invalid_format':
        if (field === 'email') return t('validation.email');
        if (field === 'recoveryCode') return t('validation.recoveryCode');
        return field === 'code' ? t('validation.code') : t('validation.invalid');
      case 'too_big':
        return t('validation.tooLong');
      case 'invalid_type':
        return t('validation.required');
      default:
        return t('validation.invalid');
    }
  };
}
