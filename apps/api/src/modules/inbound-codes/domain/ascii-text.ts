/**
 * Utilidades de texto ASCII para comparar datos de terceros sin plegado Unicode.
 *
 * Por qué no `toLowerCase()` ni `normalize('NFKC')`: ambos pliegan caracteres confundibles a ASCII (por
 * ejemplo el signo Kelvin U+212A pasa a `k` y las letras de ancho completo pasan a su forma normal), con
 * lo que un remitente falsificado con Unicode podría igualar al exacto. Aquí solo se baja a minúsculas
 * `A-Z`; cualquier otro carácter se conserva y, si no es ASCII visible, quien llama rechaza el texto.
 */

const CODE_UPPERCASE_A = 65;
const CODE_UPPERCASE_Z = 90;
const CODE_LOWERCASE_A = 97;
const CODE_LOWERCASE_Z = 122;
const CODE_DIGIT_ZERO = 48;
const CODE_DIGIT_NINE = 57;
const ASCII_CASE_OFFSET = 32;
/** Primer y último carácter ASCII visible (excluye espacio, controles y DEL). */
const CODE_FIRST_VISIBLE_ASCII = 33;
const CODE_LAST_VISIBLE_ASCII = 126;

export function isAsciiDigitCode(code: number): boolean {
  return code >= CODE_DIGIT_ZERO && code <= CODE_DIGIT_NINE;
}

export function isAsciiLetterOrDigitCode(code: number): boolean {
  const isUppercaseLetter = code >= CODE_UPPERCASE_A && code <= CODE_UPPERCASE_Z;
  const isLowercaseLetter = code >= CODE_LOWERCASE_A && code <= CODE_LOWERCASE_Z;
  return isAsciiDigitCode(code) || isUppercaseLetter || isLowercaseLetter;
}

export function isVisibleAsciiCode(code: number): boolean {
  return code >= CODE_FIRST_VISIBLE_ASCII && code <= CODE_LAST_VISIBLE_ASCII;
}

/** `true` si todos los caracteres son ASCII visibles (sin espacios, controles ni Unicode). */
export function isVisibleAsciiOnly(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!isVisibleAsciiCode(value.charCodeAt(index))) return false;
  }
  return true;
}

/** Minúsculas solo para `A-Z`; el resto de los caracteres queda intacto. */
export function toAsciiLowercase(value: string): string {
  let lowercased = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isUppercaseLetter = code >= CODE_UPPERCASE_A && code <= CODE_UPPERCASE_Z;
    lowercased += isUppercaseLetter
      ? String.fromCharCode(code + ASCII_CASE_OFFSET)
      : value.charAt(index);
  }
  return lowercased;
}
