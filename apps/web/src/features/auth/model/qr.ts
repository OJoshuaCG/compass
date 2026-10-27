/**
 * Genera el QR de enrolamiento EN EL CLIENTE: la URI `otpauth://` (que contiene la clave) nunca
 * sale hacia un servicio externo. Se devuelve un data URL SVG, que un `<img>` renderiza sin
 * ejecutar scripts. La biblioteca se carga bajo demanda: solo la pantalla de enrolamiento la usa.
 * Nota CSP: mostrarlo exige `img-src 'self' data:` en la política del backend.
 */
export async function generateQrDataUrl(otpauthUri: string): Promise<string> {
  const { toString } = await import('qrcode');
  const svg = await toString(otpauthUri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
