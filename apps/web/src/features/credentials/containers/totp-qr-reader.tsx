import { Alert, Button, FormField, Input, RadioGroup, Spinner, type RadioOption } from '@iam/ui';
import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { MigrationEntry } from '../model/google-authenticator-migration';
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

/**
 * Resultado de la lectura tal como lo muestra la pantalla. Una exportación de Google Authenticator
 * se reduce a estos casos: una sola cuenta equivale a `found`, varias esperan una elección y sin
 * ninguna importable es un error con su propio texto.
 */
type ReaderOutcome =
  Exclude<QrReadResult['kind'], 'migration'> | 'migration_choose' | 'migration_none_importable';

type SkippedCounts = { hotp: number; unsupported: number };

const NO_SKIPPED: SkippedCounts = { hotp: 0, unsupported: 0 };

const MESSAGE_KEY_BY_KIND = {
  no_qr: 'totp.register.image.noQr',
  not_totp_uri: 'totp.register.image.notTotp',
  migration_invalid: 'totp.register.image.migration.invalid',
  migration_none_importable: 'totp.register.image.migration.noneImportable',
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
 * Los mensajes de error nunca incluyen lo decodificado. Una exportación de Google Authenticator se
 * importa cuenta por cuenta: con una sola cuenta TOTP se usa directo; con varias, la persona elige
 * una (cada credencial lleva un solo segundo factor) y el resto se descarta de la memoria.
 */
export function TotpQrReader({ onResult }: TotpQrReaderProps) {
  const { t } = useTranslation('credentials');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const [reading, setReading] = useState(false);
  const [outcomeKind, setOutcomeKind] = useState<ReaderOutcome | null>(null);
  // Las cuentas de una exportación con varias (llevan secretos) viven solo aquí, solo mientras la
  // persona elige, y se descartan al elegir, cancelar, leer otra imagen o desmontar.
  const [migrationChoices, setMigrationChoices] = useState<readonly MigrationEntry[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<string | undefined>(undefined);
  const [skipped, setSkipped] = useState<SkippedCounts>(NO_SKIPPED);
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
    discardMigrationChoices();
    onResult(null);
    const result = await reader();
    // Si el diálogo se cerró mientras se leía, el resultado se descarta sin tocar el estado.
    if (!isMountedRef.current) return;
    setReading(false);
    if (result.kind === 'migration') {
      applyMigration(result.entries, {
        hotp: result.skippedHotp,
        unsupported: result.skippedUnsupported,
      });
      return;
    }
    setOutcomeKind(result.kind);
    onResult(result.kind === 'found' ? result.otpauthUri : null);
  }

  function discardMigrationChoices() {
    setMigrationChoices(null);
    setSelectedIndex(undefined);
    setSkipped(NO_SKIPPED);
  }

  function applyMigration(entries: readonly MigrationEntry[], skippedCounts: SkippedCounts) {
    setSkipped(skippedCounts);
    const [onlyEntry] = entries;
    if (entries.length === 0 || onlyEntry === undefined) {
      setOutcomeKind('migration_none_importable');
      return;
    }
    if (entries.length === 1) {
      // Una sola cuenta importable se usa igual que un QR normal: sin pedir elegir.
      setOutcomeKind('found');
      onResult(onlyEntry.otpauthUri);
      return;
    }
    setMigrationChoices(entries);
    setOutcomeKind('migration_choose');
  }

  function handleConfirmChoice() {
    const chosen =
      migrationChoices !== null && selectedIndex !== undefined
        ? migrationChoices[Number(selectedIndex)]
        : undefined;
    if (chosen === undefined) return;
    onResult(chosen.otpauthUri);
    setOutcomeKind('found');
    // Las demás cuentas, con sus secretos, se olvidan en cuanto se elige una.
    setMigrationChoices(null);
    setSelectedIndex(undefined);
  }

  function handleCancelChoice() {
    discardMigrationChoices();
    setOutcomeKind(null);
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
    // Igual que los botones: una lectura en curso no se solapa con otra, para que un resultado tardío no pise al nuevo.
    if (reading) return;
    const file = imageItem?.getAsFile() ?? null;
    if (file === null) return;
    void readFrom(() => readQrFromImageFile(file));
  }

  const messageKey =
    outcomeKind !== null && outcomeKind !== 'found' && outcomeKind !== 'migration_choose'
      ? MESSAGE_KEY_BY_KIND[outcomeKind]
      : null;

  const choiceOptions: readonly RadioOption[] = (migrationChoices ?? []).map((entry, index) => ({
    value: String(index),
    label:
      entry.label === ''
        ? t('totp.register.image.migration.unnamed', { position: index + 1 })
        : entry.label,
  }));

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
      {outcomeKind === 'migration_choose' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">{t('totp.register.image.migration.help')}</p>
          <RadioGroup
            legend={t('totp.register.image.migration.legend')}
            options={choiceOptions}
            value={selectedIndex}
            onValueChange={setSelectedIndex}
          />
          <div className="flex flex-wrap gap-3">
            <Button disabled={selectedIndex === undefined} onClick={handleConfirmChoice}>
              {t('totp.register.image.migration.confirm')}
            </Button>
            <Button variant="secondary" onClick={handleCancelChoice}>
              {t('totp.register.image.migration.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {messageKey === null ? null : (
        <Alert tone="danger">
          {t(messageKey, {
            maxSide: QR_MAX_IMAGE_SIDE_PX,
            maxMegabytes: QR_MAX_FILE_MEGABYTES,
          })}
        </Alert>
      )}
      {skipped.hotp > 0 || skipped.unsupported > 0 ? (
        <Alert tone="warning">
          {skipped.hotp > 0 ? (
            <p>{t('totp.register.image.migration.skippedHotp', { count: skipped.hotp })}</p>
          ) : null}
          {skipped.unsupported > 0 ? (
            <p>
              {t('totp.register.image.migration.skippedUnsupported', {
                count: skipped.unsupported,
              })}
            </p>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
