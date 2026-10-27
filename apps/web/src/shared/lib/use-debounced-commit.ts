import { useEffect, useEffectEvent, useState } from 'react';

/**
 * Campo de texto con confirmación diferida: `draft` responde a cada tecla y `commit` (que suele
 * escribir en la URL y disparar la petición) se llama solo cuando el usuario deja de escribir.
 * Si `committed` cambia desde fuera (p. ej. "Limpiar filtros"), el borrador lo sigue.
 */
export function useDebouncedCommit(
  committed: string,
  commit: (value: string) => void,
  delayMs = 300,
): [draft: string, setDraft: (value: string) => void] {
  const [draft, setDraft] = useState(committed);
  const [seenCommitted, setSeenCommitted] = useState(committed);
  if (committed !== seenCommitted) {
    // Ajuste durante el render (patrón recomendado por React) en vez de un efecto.
    setSeenCommitted(committed);
    setDraft(committed);
  }

  const commitDraft = useEffectEvent((value: string) => {
    commit(value);
  });

  useEffect(() => {
    if (draft === committed) return;
    const id = window.setTimeout(() => {
      commitDraft(draft);
    }, delayMs);
    return () => {
      window.clearTimeout(id);
    };
  }, [draft, committed, delayMs]);

  return [draft, setDraft];
}
