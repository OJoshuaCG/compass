import axe from 'axe-core';

/**
 * axe-core directo (vitest-axe está desactualizado). `color-contrast` se desactiva porque
 * jsdom no calcula estilos; el contraste de tokens lo cubre su propia prueba.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}
