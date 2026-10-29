/**
 * Copia un secreto al portapapeles y lo borra pasado `clearAfterMs`, pero solo si el portapapeles
 * todavía contiene ese mismo valor (mejor esfuerzo, docs/frontend.md §9). Devuelve `false` si el
 * navegador rechazó la escritura.
 *
 * El temporizador no se cancela al desmontar: el objetivo es limpiar el secreto aunque la persona
 * ya haya salido de la pantalla.
 */
export async function copySecretWithAutoClear(
  value: string,
  clearAfterMs: number,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return false;
  }
  window.setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === value) await navigator.clipboard.writeText('');
      } catch {
        // Sin permiso de lectura no se puede verificar el contenido: no se toca para no destruir
        // lo que la persona haya copiado después.
      }
    })();
  }, clearAfterMs);
  return true;
}
