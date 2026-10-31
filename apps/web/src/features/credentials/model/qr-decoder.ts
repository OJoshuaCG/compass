import jsQR from 'jsqr';

import {
  parseGoogleAuthenticatorMigration,
  type MigrationEntry,
} from './google-authenticator-migration';

/** Lado máximo aceptado. Por encima, decodificar costaría memoria y segundos sin ganar nada. */
export const QR_MAX_IMAGE_SIDE_PX = 4096;

/**
 * Lado al que se reduce una imagen grande antes de decodificar. Un QR legible no necesita más, y
 * jsQR recorre cada píxel: reducir acota el tiempo y la memoria del lienzo.
 */
export const QR_DECODE_TARGET_SIDE_PX = 2000;

const RGBA_CHANNELS = 4;
const OTPAUTH_TOTP_PREFIX = 'otpauth://totp/';
const OTPAUTH_MIGRATION_PREFIX = 'otpauth-migration://';

/**
 * Resultado de leer una imagen. Ninguna variante de error lleva el contenido decodificado: un QR
 * ajeno (o un enlace con secreto) no debe terminar en un mensaje, un registro ni una caché.
 */
export type QrDecodeResult =
  | { kind: 'found'; otpauthUri: string }
  | { kind: 'no_qr' }
  /** Hay un QR, pero no es un enlace `otpauth://totp/` (un sitio web, un HOTP, texto libre...). */
  | { kind: 'not_totp_uri' }
  /**
   * Exportación de Google Authenticator (`otpauth-migration://`) leída. Las entradas llevan secretos,
   * igual que `found` lleva el enlace; los contadores no llevan nada del contenido.
   */
  | {
      kind: 'migration';
      entries: readonly MigrationEntry[];
      skippedHotp: number;
      skippedUnsupported: number;
    }
  /** Es una exportación de Google Authenticator, pero está mal formada, vacía o rebasa los límites. */
  | { kind: 'migration_invalid' }
  | { kind: 'image_too_large' }
  | { kind: 'unreadable' };

export type PixelBuffer = {
  /** RGBA, 4 bytes por píxel, como `ImageData.data`. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export function isWithinSizeLimit(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= QR_MAX_IMAGE_SIDE_PX &&
    height <= QR_MAX_IMAGE_SIDE_PX
  );
}

function classifyMigrationUri(migrationUri: string): QrDecodeResult {
  const parsed = parseGoogleAuthenticatorMigration(migrationUri);
  if (parsed.kind === 'invalid') return { kind: 'migration_invalid' };
  return {
    kind: 'migration',
    entries: parsed.entries,
    skippedHotp: parsed.skippedHotp,
    skippedUnsupported: parsed.skippedUnsupported,
  };
}

/** Decide qué hacer con el texto de un QR sin devolverlo salvo cuando es un TOTP válido de forma. */
export function classifyDecodedText(decodedText: string): QrDecodeResult {
  const trimmed = decodedText.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith(OTPAUTH_MIGRATION_PREFIX)) return classifyMigrationUri(trimmed);
  if (lowered.startsWith(OTPAUTH_TOTP_PREFIX)) return { kind: 'found', otpauthUri: trimmed };
  return { kind: 'not_totp_uri' };
}

/** Decodifica píxeles ya extraídos. Pura: no toca el DOM, por eso se prueba con un QR generado. */
export function decodeQrFromPixels(pixels: PixelBuffer): QrDecodeResult {
  if (!isWithinSizeLimit(pixels.width, pixels.height)) return { kind: 'image_too_large' };
  if (pixels.data.length !== pixels.width * pixels.height * RGBA_CHANNELS) {
    return { kind: 'unreadable' };
  }
  try {
    // `attemptBoth` cubre capturas de pantalla en tema oscuro (QR claro sobre fondo oscuro).
    const code = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (code === null) return { kind: 'no_qr' };
    return classifyDecodedText(code.data);
  } catch {
    return { kind: 'unreadable' };
  }
}

export function scaledDimensions(width: number, height: number): { width: number; height: number } {
  const longestSide = Math.max(width, height);
  if (longestSide <= QR_DECODE_TARGET_SIDE_PX) return { width, height };
  const ratio = QR_DECODE_TARGET_SIDE_PX / longestSide;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Dibuja la fuente (imagen o fotograma de vídeo) en un lienzo fuera de pantalla, reducida si hace
 * falta, y la decodifica. El tamaño se valida ANTES de reservar el lienzo. El lienzo se vacía al
 * terminar para no dejar píxeles del código (que contienen el secreto) en memoria.
 */
export function decodeQrFromDrawable(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): QrDecodeResult {
  if (!isWithinSizeLimit(sourceWidth, sourceHeight)) return { kind: 'image_too_large' };

  const target = scaledDimensions(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return { kind: 'unreadable' };
    context.drawImage(source, 0, 0, target.width, target.height);
    const imageData = context.getImageData(0, 0, target.width, target.height);
    return decodeQrFromPixels({
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
    });
  } catch {
    return { kind: 'unreadable' };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
