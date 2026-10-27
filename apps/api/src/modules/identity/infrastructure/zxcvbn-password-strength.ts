import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import * as es from '@zxcvbn-ts/language-es-es';

import type { PasswordStrength } from '../application/ports/identity-ports.js';

/**
 * Fortaleza con zxcvbn-ts y diccionarios locales (común, inglés y español): no hay llamadas de
 * red y la contraseña nunca sale del proceso.
 */
export class ZxcvbnPasswordStrength implements PasswordStrength {
  private readonly factory = new ZxcvbnFactory({
    translations: en.translations,
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary, ...es.dictionary },
  });

  score(password: string, userInputs: readonly string[]): number {
    return this.factory.check(password, [...userInputs]).score;
  }
}
