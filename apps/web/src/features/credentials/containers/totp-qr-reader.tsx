import { Alert, Button, FormField, Input, Spinner } from '@iam/ui';
import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { QR_MAX_IMAGE_SIDE_PX } from '../model/qr-decoder';
import {
  isDisplayCaptureSupported,
  QR_ACCEPTED_IMAGE_TYPES,
  QR_MAX_FILE_MEGABYTES,
  readQrFromImageFile,
  readQrFromScreenCapture,
  type QrReadResult,
} from '../model/qr-image-sources';

export type TotpQrReaderProps = {
  /**
   * Entrega el enlace `otpauth://` leído, o `null` cuando una lectura nueva falla (para que un
   * enlace anterior no se envíe por descuido). El enlace solo vive en el estado del formulario.
   */
  onResult: (otpauthUri: string | null) => void;
};

const MESSAGE_KEY_BY_KIND = {
  no_qr: 'totp.register.image.noQr',
  not_totp_uri: 'totp.register.image.notTotp',
  migration_uri: 'totp.register.image.migration',
  image_too_large: 'totp.register.image.tooLarge',
  unreadable: 'totp.register.image.unreadable',
  unsupported_image: 'totp.register.image.unsupported',
  capture_denied: 'totp.register.image.captureDenied',
  capture_failed: 'totp.register.image.captureFailed',
} as const;

/**
 * Lee el QR del segundo factor desde una imagen: archivo, imagen pegada o captura de pestaña. Todo
 * ocurre en el navegador; la imagen, el lienzo y el fotograma se descartan tras decodificar y solo
 * el enlace extraído sube al formulario, que lo manda por el mismo registro que la clave manual.
 * Los mensajes de error nunca incluyen lo decodificado.
 */
export function TotpQrReader({ onResult }: TotpQrReaderProps) {
  const { t } = useTranslation('credentials');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const [reading, setReading] = useState(false);
  const [outcomeKind, setOutcomeKind] = useState<QrReadResult['kind'] | null>(null);
  const captureSupported = isDisplayCaptureSupported();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function readFrom(reader: () => Promise<QrReadResult>) {
    setReading(true);
    setOutcomeKind(null);
    onResult(null);
    const result = await reader();
    // Si el diálogo se cerró mientras se leía, el resultado se descarta sin tocar el estado.
    if (!isMountedRef.current) return;
    setReading(false);
    setOutcomeKind(result.kind);
    onResult(result.kind === 'found' ? result.otpauthUri : null);
  }

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Se vacía el control para poder elegir de nuevo el mismo archivo y no retener su referencia.
    event.target.value = '';
    if (file === undefined) return;
    void readFrom(() => readQrFromImageFile(file));
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    // El campo solo recibe imágenes: el texto pegado se ignora para no mezclarlo con la clave manual.
    event.preventDefault();
    const file = imageItem?.getAsFile() ?? null;
    if (file === null) return;
    void readFrom(() => readQrFromImageFile(file));
  }

  const messageKey =
    outcomeKind !== null && outcomeKind !== 'found' ? MESSAGE_KEY_BY_KIND[outcomeKind] : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{t('totp.register.image.help')}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={reading}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          {t('totp.register.image.choose')}
        </Button>
        {captureSupported ? (
          <Button
            variant="secondary"
            disabled={reading}
            onClick={() => {
              void readFrom(readQrFromScreenCapture);
            }}
          >
            {t('totp.register.image.capture')}
          </Button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept={QR_ACCEPTED_IMAGE_TYPES.join(',')}
          aria-label={t('totp.register.image.fileLabel')}
          data-testid="totp-qr-file-input"
          onChange={handleFileChosen}
        />
      </div>
      {captureSupported ? (
        <p className="text-xs text-text-secondary">{t('totp.register.image.captureHelp')}</p>
      ) : null}
      <FormField
        label={t('totp.register.image.pasteLabel')}
        help={t('totp.register.image.pasteHelp')}
      >
        {(controlProps) => (
          <Input {...controlProps} value="" readOnly autoComplete="off" onPaste={handlePaste} />
        )}
      </FormField>
      {reading ? <Spinner label={t('totp.register.image.reading')} /> : null}
      {outcomeKind === 'found' ? (
        <Alert tone="success">{t('totp.register.image.found')}</Alert>
      ) : null}
      {messageKey === null ? null : (
        <Alert tone={outcomeKind === 'migration_uri' ? 'warning' : 'danger'}>
          {t(messageKey, {
            maxSide: QR_MAX_IMAGE_SIDE_PX,
            maxMegabytes: QR_MAX_FILE_MEGABYTES,
          })}
        </Alert>
      )}
    </div>
  );
}
