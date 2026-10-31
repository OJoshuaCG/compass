import type { TotpParameters } from '../../domain/otpauth-uri.js';

/**
 * Generador de códigos TOTP (RFC 6238) detrás de un puerto: el caso de uso no conoce la librería.
 * El secreto solo vive dentro de la llamada; quien llama lo obtiene del módulo de criptografía.
 */
export interface TotpGenerator {
  /** Código vigente en el instante `at`. */
  codeAt(secretBase32: string, parameters: TotpParameters, at: Date): string;
}
