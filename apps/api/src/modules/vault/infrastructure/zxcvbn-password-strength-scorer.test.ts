import { describe, expect, it } from 'vitest';

import { ZxcvbnPasswordStrengthScorer } from './zxcvbn-password-strength-scorer.js';

describe('ZxcvbnPasswordStrengthScorer', () => {
  const scorer = new ZxcvbnPasswordStrengthScorer();

  it('puntúa una contraseña trivial en el extremo bajo y una larga y aleatoria en el alto', () => {
    expect(scorer.score('password')).toBeLessThanOrEqual(1);
    expect(scorer.score('k9#Vq2!xLm7@Rt4$Zp8&')).toBe(4);
  });

  it('siempre devuelve un entero de 0 a 4', () => {
    for (const password of ['', 'a', '123456', 'correct horse battery staple', 'ñandú-Ωmega-9']) {
      const result = scorer.score(password);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  it('valora una contraseña muy larga sin colgarse: solo mira los primeros caracteres', () => {
    const veryLongPassword = 'ab'.repeat(5_000);
    const startedAt = Date.now();

    const result = scorer.score(veryLongPassword);

    expect(result).toBeLessThanOrEqual(4);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
