import { decodeQrFromDrawable, type QrDecodeResult } from './qr-decoder';

export const QR_ACCEPTED_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

const BYTES_PER_MEGABYTE = 1024 * 1024;
export const QR_MAX_FILE_MEGABYTES = 10;
const QR_MAX_FILE_BYTES = QR_MAX_FILE_MEGABYTES * BYTES_PER_MEGABYTE;

/** Si el navegador no avisa del primer fotograma, se espera este margen antes de leerlo. */
const FRAME_SETTLE_MS = 150;
const FRAME_WAIT_LIMIT_MS = 1500;

export type QrReadResult =
  | QrDecodeResult
  | { kind: 'unsupported_image' }
  | { kind: 'capture_denied' }
  | { kind: 'capture_failed' };

/** `getDisplayMedia` falta en navegadores móviles y en contextos no seguros: ahí se oculta la opción. */
export function isDisplayCaptureSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mediaDevices = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  return typeof mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Lee un QR de un archivo o imagen pegada. Se usa `createImageBitmap` y no un ObjectURL en un
 * `<img>`: la CSP solo permite `img-src 'self' data:` (un `blob:` se bloquearía) y así no queda
 * ninguna URL que revocar. La imagen nunca sale del navegador.
 */
export async function readQrFromImageFile(file: File): Promise<QrReadResult> {
  if (!QR_ACCEPTED_IMAGE_TYPES.includes(file.type)) return { kind: 'unsupported_image' };
  if (file.size > QR_MAX_FILE_BYTES) return { kind: 'image_too_large' };

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    return decodeQrFromDrawable(bitmap, bitmap.width, bitmap.height);
  } catch {
    return { kind: 'unreadable' };
  } finally {
    bitmap?.close();
  }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Espera a que el vídeo tenga al menos un fotograma pintado (el primero puede salir en negro). */
async function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  await video.play();
  if (typeof video.requestVideoFrameCallback === 'function') {
    await Promise.race([
      new Promise<void>((resolve) => {
        video.requestVideoFrameCallback(() => {
          resolve();
        });
      }),
      waitFor(FRAME_WAIT_LIMIT_MS),
    ]);
    return;
  }
  await waitFor(FRAME_SETTLE_MS);
}

/**
 * Pide compartir una pestaña, ventana o pantalla, toma UN fotograma, lo decodifica y detiene todas
 * las pistas de inmediato (también si algo falla), para que el navegador deje de mostrar que se
 * comparte la pantalla. Nada se graba ni se guarda.
 */
export async function readQrFromScreenCapture(): Promise<QrReadResult> {
  if (!isDisplayCaptureSupported()) return { kind: 'capture_failed' };

  let stream: MediaStream | undefined;
  const video = document.createElement('video');
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForFirstFrame(video);
    if (video.videoWidth === 0 || video.videoHeight === 0) return { kind: 'capture_failed' };
    return decodeQrFromDrawable(video, video.videoWidth, video.videoHeight);
  } catch (error) {
    // Cancelar el selector del navegador también llega como NotAllowedError.
    const wasDenied = error instanceof DOMException && error.name === 'NotAllowedError';
    return wasDenied ? { kind: 'capture_denied' } : { kind: 'capture_failed' };
  } finally {
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    video.pause();
    video.srcObject = null;
  }
}
