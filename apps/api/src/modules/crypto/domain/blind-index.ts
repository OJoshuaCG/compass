/**
 * Propósitos de índice ciego / huella. Cada uno deriva su propia clave con HKDF
 * (etiqueta distinta por uso) para no mezclar propósitos de clave.
 */
export type BlindIndexPurpose = 'platform-username' | 'password-fingerprint';

const encoder = new TextEncoder();

export const blindIndexInfo = (purpose: BlindIndexPurpose): Uint8Array =>
  encoder.encode(`iam/blind-index/v1/${purpose}`);

export const utf8 = (value: string): Uint8Array => encoder.encode(value);
