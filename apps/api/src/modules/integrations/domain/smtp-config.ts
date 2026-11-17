import type { SmtpSecurityValue } from '@iam/contracts';

/** Tipo de integración que guarda el servidor SMTP de una organización (CHECK de la migración 0044). */
export const SMTP_INTEGRATION_KIND = 'smtp_mail';

/** Permiso que gobierna el servidor SMTP: solo la Raíz (techo 0), igual que el canal de infraestructura. */
export const SMTP_MANAGE_PERMISSION = 'alerts.infra.manage';

/**
 * Solo canales cifrados. `none` no existe a propósito: el usuario y la contraseña viajarían en claro.
 * STARTTLS (587) y TLS implícito (465) cubren a los proveedores de correo habituales.
 */
export const SMTP_SECURITY_MODES: readonly SmtpSecurityValue[] = ['starttls', 'tls'];

const HOST_MAX_LENGTH = 253;
const HOST_LABEL_MAX_LENGTH = 63;
const USERNAME_MAX_LENGTH = 254;
const FROM_ADDRESS_MAX_LENGTH = 254;
export const SMTP_PASSWORD_MAX_LENGTH = 512;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const LAST_C0_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

const HOST_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** Dirección simple `local@dominio`: el servidor SMTP hace la validación final de entregabilidad. */
const FROM_ADDRESS_PATTERN = /^[^\s@<>(),;:"[\]\\]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code: number = character.codePointAt(0) ?? 0;
    if (code <= LAST_C0_CONTROL_CODE || code === DELETE_CODE) return true;
  }
  return false;
}

/**
 * Nombre de host DNS: sin esquema, puerto, ruta ni espacios, y con al menos un punto (un nombre sin
 * dominio resolvería en la red interna del contenedor). Devuelve el host en minúsculas o `null`.
 * Las direcciones IP literales se rechazan: la comprobación de red privada se hace sobre nombres
 * resueltos, y un literal permitiría saltarla.
 */
export function normalizeSmtpHost(raw: string): string | null {
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > HOST_MAX_LENGTH) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  const everyLabelValid = labels.every(
    (label) => label.length <= HOST_LABEL_MAX_LENGTH && HOST_LABEL_PATTERN.test(label),
  );
  if (!everyLabelValid) return null;
  const lastLabel = labels[labels.length - 1] ?? '';
  // Un último segmento solo numérico es una IP (o algo que un resolvedor leería como tal).
  if (/^\d+$/.test(lastLabel)) return null;
  return host;
}

export function isValidSmtpPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

export function isSmtpSecurity(value: string): value is SmtpSecurityValue {
  return (SMTP_SECURITY_MODES as readonly string[]).includes(value);
}

/** Usuario SMTP: texto sin caracteres de control (evita inyectar comandos en el diálogo SMTP). */
export function normalizeSmtpUsername(raw: string): string | null {
  const username = raw.trim();
  if (username.length === 0 || username.length > USERNAME_MAX_LENGTH) return null;
  if (hasControlCharacter(username)) return null;
  return username;
}

export function normalizeSmtpFromAddress(raw: string): string | null {
  const address = raw.trim();
  if (address.length === 0 || address.length > FROM_ADDRESS_MAX_LENGTH) return null;
  if (!FROM_ADDRESS_PATTERN.test(address)) return null;
  return address;
}

/** La contraseña no se recorta (los espacios pueden ser parte de ella) pero no admite saltos de línea. */
export function isValidSmtpPassword(password: string): boolean {
  if (password.length === 0 || password.length > SMTP_PASSWORD_MAX_LENGTH) return false;
  return !hasControlCharacter(password);
}
