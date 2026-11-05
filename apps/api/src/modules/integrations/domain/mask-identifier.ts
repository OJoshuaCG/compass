/**
 * Censura de identificadores (usuarios, correos, nombres de cuenta) para los avisos que salen
 * hacia un tercero como Telegram (ADR 0047, regla de censura).
 *
 * Regla: cada tramo de letras o dígitos conserva solo su primer carácter seguido de un sufijo fijo;
 * los separadores se conservan. En un correo, la terminación del dominio (lo que sigue al último
 * punto) se conserva completa. El sufijo es fijo para no revelar la longitud real del tramo.
 *
 * Nunca debe recibir un secreto: un valor secreto no se envía, ni siquiera censurado.
 */

const MASK_SUFFIX = '***';
const EMAIL_SEPARATOR = '@';
const DOMAIN_LABEL_SEPARATOR = '.';

/** Un tramo es una racha de letras o dígitos de cualquier alfabeto; lo demás es separador. */
const ALPHANUMERIC_RUN = /[\p{L}\p{N}]+/gu;

function maskAlphanumericRuns(text: string): string {
  return text.replace(ALPHANUMERIC_RUN, (run: string): string => {
    // Se toma el primer punto de código y no el primer índice, para no partir un par sustituto.
    const firstCodePoint: string = Array.from(run)[0] ?? '';
    return `${firstCodePoint}${MASK_SUFFIX}`;
  });
}

export function maskIdentifier(identifier: string): string {
  const emailSeparatorIndex: number = identifier.lastIndexOf(EMAIL_SEPARATOR);
  const isEmailLike: boolean = emailSeparatorIndex > 0;

  if (!isEmailLike) {
    return maskAlphanumericRuns(identifier);
  }

  const localPart: string = identifier.slice(0, emailSeparatorIndex);
  const domain: string = identifier.slice(emailSeparatorIndex + 1);
  const topLevelSeparatorIndex: number = domain.lastIndexOf(DOMAIN_LABEL_SEPARATOR);
  const hasTopLevelLabel: boolean = topLevelSeparatorIndex > 0;

  if (!hasTopLevelLabel) {
    return `${maskAlphanumericRuns(localPart)}${EMAIL_SEPARATOR}${maskAlphanumericRuns(domain)}`;
  }

  const domainWithoutTopLevel: string = domain.slice(0, topLevelSeparatorIndex);
  const topLevelLabel: string = domain.slice(topLevelSeparatorIndex + 1);

  return (
    `${maskAlphanumericRuns(localPart)}${EMAIL_SEPARATOR}` +
    `${maskAlphanumericRuns(domainWithoutTopLevel)}${DOMAIN_LABEL_SEPARATOR}${topLevelLabel}`
  );
}
