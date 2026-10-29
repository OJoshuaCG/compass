import { CopyButton, FormField, Input } from '@iam/ui';
import { useTranslation } from 'react-i18next';

/** El secreto se limpia del portapapeles pasado este tiempo (docs/frontend.md §9). */
const CLIPBOARD_CLEAR_MS = 30_000;

export type TotpSetupPanelProps = {
  /** Data URL del QR (generado en el cliente). */
  qrSrc: string;
  /** Clave Base32 para escribir a mano. */
  secret: string;
};

/** QR y clave en texto del enrolamiento TOTP. Presentacional: no sabe de HTTP. */
export function TotpSetupPanel({ qrSrc, secret }: TotpSetupPanelProps) {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{t('enroll.scan', { ns: 'auth' })}</p>
      {/* Tamaño explícito: evita saltos de layout (CLS) mientras carga la imagen. */}
      <img
        src={qrSrc}
        alt={t('enroll.qrAlt', { ns: 'auth' })}
        width={192}
        height={192}
        className="size-48 self-center rounded-md"
      />
      <p className="text-sm text-text-secondary">{t('enroll.manual', { ns: 'auth' })}</p>
      {/* El rol `code` no admite nombre accesible: la clave va en un campo de solo lectura con su
          etiqueta visible, así el lector de pantalla anuncia nombre y valor. El valor sigue solo en
          las props de este componente; no se registra ni se guarda. */}
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('enroll.secretLabel', { ns: 'auth' })} className="min-w-0 flex-1">
          {(controlProps) => (
            <Input
              {...controlProps}
              value={secret}
              readOnly
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        <CopyButton
          value={secret}
          label={t('enroll.copySecret', { ns: 'auth' })}
          copiedLabel={t('clipboard.copied', { ns: 'common' })}
          failedLabel={t('clipboard.failed', { ns: 'common' })}
          clearAfterMs={CLIPBOARD_CLEAR_MS}
          size="sm"
        />
      </div>
    </div>
  );
}
