import axe from 'axe-core';

/**
 * Ejecuta axe-core directamente (vitest-axe está desactualizado) y devuelve los
 * resultados legibles de las violaciones. `color-contrast` se desactiva porque jsdom no
 * calcula estilos: el contraste lo cubre la prueba de tokens.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}
