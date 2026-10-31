import type { CreateInvitationWithLinkResponse } from '@iam/contracts';
import { Alert, Button, CopyButton, FormField, Input } from '@iam/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

/** Mismo plazo que el resto de secretos copiados (docs/frontend.md §9): el portapapeles se limpia. */
const CLIPBOARD_CLEAR_MS = 30_000;

export type InvitationLinkPanelProps = {
  /** Respuesta de la ruta con enlace. Vive solo en el estado del componente que la pasa. */
  invitation: CreateInvitationWithLinkResponse;
  /** Zona horaria del perfil, para mostrar el vencimiento. */
  timeZone: string | undefined;
  onClose: () => void;
};

/**
 * Muestra el enlace de invitación una sola vez: campo de solo lectura, botón de copiar, si el correo
 * salió y el vencimiento. Presentacional: no guarda el enlace en ningún lado (ni almacenamiento ni
 * atributos), solo lo pinta mientras exista en el estado de su container.
 */
export function InvitationLinkPanel({ invitation, timeZone, onClose }: InvitationLinkPanelProps) {
  const { t, i18n } = useTranslation(['directory', 'common']);
  // Al desmontarse el formulario el foco se pierde: se lleva al encabezado del panel, que se anuncia.
  const headingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p ref={headingRef} tabIndex={-1} role="status" className="text-sm font-medium text-text">
        {t('link.heading', { ns: 'directory', email: invitation.email })}
      </p>
      {invitation.emailSent ? (
        <Alert tone="success">
          {t('link.emailSent', { ns: 'directory', email: invitation.email })}
        </Alert>
      ) : (
        <Alert tone="warning">{t('link.emailFailed', { ns: 'directory' })}</Alert>
      )}
      <FormField label={t('link.field', { ns: 'directory' })}>
        {(field) => (
          <Input
            {...field}
            readOnly
            value={invitation.link}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton
          value={invitation.link}
          label={t('link.copy', { ns: 'directory' })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
          size="sm"
        />
      </div>
      <p className="text-sm text-text-secondary">
        {t('link.expires', {
          ns: 'directory',
          date: formatDateTime(invitation.expiresAt, i18n.language, timeZone),
        })}
      </p>
      <Alert tone="warning">{t('link.warning', { ns: 'directory' })}</Alert>
      <div className="flex justify-end">
        <Button onClick={onClose}>{t('link.close', { ns: 'directory' })}</Button>
      </div>
    </div>
  );
}
