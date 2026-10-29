import {
  registerTotpRequestSchema,
  type CredentialTotp,
  type TotpCode,
  type TotpStatus,
} from '@iam/contracts';

const MILLISECONDS_PER_SECOND = 1000;

/** Un secreto anterior se conserva 30 días tras un re-registro (docs/business/two-factor.md, DF-10). */
export const TOTP_PREVIOUS_SECRET_RETENTION_DAYS = 30;

/** Cada cuánto se revisa el vigor del código en pantalla; menos de 1 s para no mostrar uno vencido. */
export const TOTP_COUNTDOWN_TICK_MS = 500;

const OTPAUTH_PREFIX = 'otpauth://';
const OTPAUTH_TOTP_PATH = 'otpauth://totp/';
const LABEL_SEPARATOR = ':';

/** Espacios y guiones con los que las plataformas agrupan la clave para leerla (`ABCD EFGH` o `ABCD-EFGH`). */
const KEY_GROUPING_CHARACTERS = /[\s-]/g;

export function looksLikeOtpauthUri(input: string): boolean {
  return input.trim().toLowerCase().startsWith(OTPAUTH_PREFIX);
}

/**
 * Deja la clave Base32 como la espera el servidor: sin separadores de lectura y en mayúsculas.
 * No valida el alfabeto ni la longitud: eso lo decide el servidor, que es quien manda.
 */
export function normalizeBase32Key(input: string): string {
  return input.replace(KEY_GROUPING_CHARACTERS, '').toUpperCase();
}

export type RegistrationFormValues = {
  /** Lo que la persona pegó: un enlace `otpauth://` o la clave Base32 en texto. */
  secretOrUri: string;
  /** Solo se usan al armar el enlace desde una clave; un enlace ya trae los suyos. */
  issuer: string;
  account: string;
  /** Nombre de la credencial: etiqueta de respaldo cuando no se escribe emisor ni cuenta. */
  fallbackLabel: string;
};

function buildLabel(values: RegistrationFormValues): string {
  const issuer = values.issuer.trim();
  const account = values.account.trim();
  if (issuer !== '' && account !== '') {
    return `${encodeURIComponent(issuer)}${LABEL_SEPARATOR}${encodeURIComponent(account)}`;
  }
  if (account !== '') return encodeURIComponent(account);
  if (issuer !== '') return encodeURIComponent(issuer);
  return encodeURIComponent(values.fallbackLabel.trim());
}

/**
 * Arma el enlace `otpauth://` que se envía al servidor. Si la persona pegó un enlace se respeta tal
 * cual; si pegó una clave se construye uno con los valores estándar (SHA1, 6 dígitos, 30 s), porque
 * la clave manual no trae parámetros. Todo valor se codifica para que un `&` en la clave no pueda
 * colar parámetros. Devuelve `null` si no hay nada que enviar o el resultado no cumple el contrato.
 */
export function buildOtpauthUri(values: RegistrationFormValues): string | null {
  const pasted = values.secretOrUri.trim();
  if (pasted === '') return null;

  let candidate: string;
  if (looksLikeOtpauthUri(pasted)) {
    candidate = pasted;
  } else {
    const secret = normalizeBase32Key(pasted);
    const issuer = values.issuer.trim();
    const issuerParameter = issuer === '' ? '' : `&issuer=${encodeURIComponent(issuer)}`;
    candidate = `${OTPAUTH_TOTP_PATH}${buildLabel(values)}?secret=${encodeURIComponent(secret)}${issuerParameter}`;
  }

  const validation = registerTotpRequestSchema.safeParse({ otpauthUri: candidate });
  return validation.success ? validation.data.otpauthUri : null;
}

/** Estado del segundo factor tal como lo ve la pantalla: `none` cuando la credencial no tiene ninguno. */
export type TotpViewStatus = TotpStatus | 'none';

export function viewStatusOf(totp: CredentialTotp | null): TotpViewStatus {
  return totp === null ? 'none' : totp.status;
}

export type TotpCapabilities = {
  /** Permiso `credential.use_totp` y nivel USE: leer el estado y pedir códigos. */
  canUse: boolean;
  /** Permiso `credential.update` y nivel EDIT: registrar, confirmar y retirar. */
  canEdit: boolean;
  /** Permiso `credential.export_totp` y nivel MANAGE: exportar la clave. */
  canExport: boolean;
};

export type TotpAvailableActions = {
  register: boolean;
  confirm: boolean;
  getCode: boolean;
  exportKey: boolean;
  retire: boolean;
};

/**
 * Qué se ofrece según el estado y lo que la persona puede hacer. Refleja las transiciones del
 * servidor (un factor retirado no emite códigos ni se exporta; solo se confirma lo pendiente), pero
 * es comodidad: el servidor decide siempre.
 */
export function availableActionsFor(
  status: TotpViewStatus,
  capabilities: TotpCapabilities,
): TotpAvailableActions {
  const isLive = status === 'pending' || status === 'verified';
  return {
    register: capabilities.canEdit,
    confirm: capabilities.canEdit && status === 'pending',
    getCode: capabilities.canUse && isLive,
    exportKey: capabilities.canExport && isLive,
    retire: capabilities.canEdit && isLive,
  };
}

/** Código emitido con el instante local en que deja de valer. El código nunca sale del estado del componente. */
export type IssuedCode = {
  code: string;
  nextCode: string | undefined;
  expiresAtMs: number;
};

export function issuedCodeFrom(response: TotpCode, nowMs: number): IssuedCode {
  return {
    code: response.code,
    nextCode: response.nextCode,
    expiresAtMs: nowMs + response.expiresIn * MILLISECONDS_PER_SECOND,
  };
}

export function secondsLeftOf(issued: IssuedCode, nowMs: number): number {
  return Math.max(0, Math.ceil((issued.expiresAtMs - nowMs) / MILLISECONDS_PER_SECOND));
}

/**
 * Avanza el código con el reloj. Al vencer, si el servidor ya había entregado el siguiente, ese pasa
 * a ser el vigente por un periodo completo (así no se pierde justo cuando más hace falta); si no
 * había siguiente, devuelve `null` y la pantalla descarta el código. Mientras no vence devuelve la
 * misma referencia, para que React no vuelva a pintar.
 */
export function advanceIssuedCode(
  issued: IssuedCode,
  nowMs: number,
  periodSeconds: number,
): IssuedCode | null {
  if (nowMs < issued.expiresAtMs) return issued;
  if (issued.nextCode === undefined) return null;
  const promoted: IssuedCode = {
    code: issued.nextCode,
    nextCode: undefined,
    expiresAtMs: issued.expiresAtMs + periodSeconds * MILLISECONDS_PER_SECOND,
  };
  return advanceIssuedCode(promoted, nowMs, periodSeconds);
}
