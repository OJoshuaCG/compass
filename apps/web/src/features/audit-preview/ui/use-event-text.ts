import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { DemoAuditEvent } from '../model/demo-events';

export type EventText = {
  /** Qué ocurrió ("Reveló una contraseña"). */
  action: string;
  /** Sobre qué: el objeto y, si la hay, su aclaración traducida. */
  subject: string;
};

/** Frases de un evento ficticio en el idioma activo; los datos (nombres, cuentas) no se traducen. */
export function useEventText(): (event: DemoAuditEvent) => EventText {
  const { t } = useTranslation('common');
  return useCallback(
    (event) => ({
      action: t(`auditPreview.action.${event.action}`, event.actionParams ?? {}),
      subject:
        event.note === undefined
          ? event.object
          : `${event.object} · ${t(`auditPreview.note.${event.note.key}`, event.note.params)}`,
    }),
    [t],
  );
}
