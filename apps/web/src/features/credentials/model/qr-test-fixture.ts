import { create } from 'qrcode';

import type { PixelBuffer } from './qr-decoder';

const MODULE_SIZE_PX = 6;
// Margen blanco que exige la especificación de QR para que el detector encuentre los bordes.
const QUIET_ZONE_MODULES = 4;
const RGBA_CHANNELS = 4;
const OPAQUE = 255;
const BLACK = 0;
const WHITE = 255;

/**
 * Pinta un QR real en un búfer RGBA sin pasar por un lienzo (jsdom no trae uno). Solo para pruebas:
 * permite que jsQR decodifique un código generado con la misma librería que usa la app.
 */
export function renderQrPixels(text: string, options: { inverted?: boolean } = {}): PixelBuffer {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const sideInModules = modules.size + QUIET_ZONE_MODULES * 2;
  const side = sideInModules * MODULE_SIZE_PX;
  const data = new Uint8ClampedArray(side * side * RGBA_CHANNELS);
  const background = options.inverted === true ? BLACK : WHITE;
  const foreground = options.inverted === true ? WHITE : BLACK;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const moduleRow = Math.floor(y / MODULE_SIZE_PX) - QUIET_ZONE_MODULES;
      const moduleColumn = Math.floor(x / MODULE_SIZE_PX) - QUIET_ZONE_MODULES;
      const insideCode =
        moduleRow >= 0 &&
        moduleColumn >= 0 &&
        moduleRow < modules.size &&
        moduleColumn < modules.size;
      const isDark = insideCode && modules.get(moduleRow, moduleColumn) === 1;
      const shade = isDark ? foreground : background;
      const offset = (y * side + x) * RGBA_CHANNELS;
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = OPAQUE;
    }
  }
  return { data, width: side, height: side };
}
