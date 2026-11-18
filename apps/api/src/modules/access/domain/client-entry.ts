/**
 * Regla de entrada a una aplicación OIDC por rango (ADR 0052, decisión 3A).
 *
 * El rango es numérico y un número menor significa más autoridad (0 Raíz ... 3 Operador). Un cliente
 * con `maxRank` solo admite a quien tiene ese rango o uno de mayor autoridad; sin `maxRank` entra
 * cualquier persona activa de la organización del cliente.
 */
export function meetsMaxRank(personRank: number, maxRank: number | null): boolean {
  if (maxRank === null) return true;
  return personRank <= maxRank;
}
