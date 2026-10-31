/**
 * Clasificación FAIL-CLOSED de lo que llega (ADR 0045 sección 1, amenaza T6, IC-1).
 *
 * La sensibilidad NO sale de un filtro editable: solo una plantilla explícita `login_code` con extracción
 * de código hace visible el elemento a quien tiene USE. Todo lo demás (restablecimientos, enlaces, tipos
 * desconocidos, ausencia de plantilla) es sensible. El valor por defecto es `sensitive`; no hay ninguna
 * ruta que lo cambie por un criterio del mensaje.
 */
import type { InboundTemplate } from './inbound-template.js';

export type ItemVisibility = 'visible_with_use' | 'sensitive';

/** Un enlace es siempre un secreto portador, aunque la plantilla diga `login_code`. */
export function classifyTemplate(template: InboundTemplate): ItemVisibility {
  const isExplicitLoginCodeTemplate =
    template.kind === 'login_code' && template.extraction.type === 'fixed_length_code';
  return isExplicitLoginCodeTemplate ? 'visible_with_use' : 'sensitive';
}

/**
 * Visibilidad del mensaje dado el conjunto de plantillas que coincidieron: solo es visible si TODAS son
 * explícitas de `login_code`. Si alguna es sensible el elemento es sensible; sin coincidencias no hay
 * nada visible.
 */
export function classifyMatchedTemplates(
  matchedTemplates: readonly InboundTemplate[],
): ItemVisibility {
  if (matchedTemplates.length === 0) return 'sensitive';
  const everyTemplateIsLoginCode = matchedTemplates.every(
    (template) => classifyTemplate(template) === 'visible_with_use',
  );
  return everyTemplateIsLoginCode ? 'visible_with_use' : 'sensitive';
}
