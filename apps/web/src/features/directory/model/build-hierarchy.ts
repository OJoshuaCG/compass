import type { ManagedUser } from '@iam/contracts';

export type HierarchyNode = {
  person: ManagedUser;
  children: HierarchyNode[];
};

export type Hierarchy = {
  /** Personas que responden directamente a quien consulta (la raíz implícita del árbol). */
  directReports: HierarchyNode[];
  /**
   * Personas cuyo responsable no llegó en la lista (por ejemplo, si se alcanzó el tope de páginas)
   * o que quedaron en un ciclo. Se muestran aparte para no perderlas en silencio.
   */
  detached: HierarchyNode[];
};

/** Menor rango primero (más autoridad); a igual rango, por nombre para un orden estable. */
function compareByRankThenName(first: ManagedUser, second: ManagedUser): number {
  if (first.rank !== second.rank) return first.rank - second.rank;
  return first.displayName.localeCompare(second.displayName);
}

/**
 * Arma el árbol de responsabilidad a partir del subárbol plano que devuelve `/users/managed`.
 * El servidor excluye a quien consulta, así que su id funciona como raíz implícita. Solo organiza
 * datos ya autorizados: no decide qué puede ver ni hacer nadie.
 */
export function buildHierarchy(people: readonly ManagedUser[], actorId: string): Hierarchy {
  const peopleById = new Map<string, ManagedUser>();
  const reportsByManagerId = new Map<string, ManagedUser[]>();
  for (const person of people) {
    peopleById.set(person.id, person);
    if (person.managedBy === null) continue;
    const siblings = reportsByManagerId.get(person.managedBy) ?? [];
    siblings.push(person);
    reportsByManagerId.set(person.managedBy, siblings);
  }

  // Cada persona se coloca una sola vez: así un ciclo de datos corruptos no recursa sin fin.
  const placedIds = new Set<string>();

  const buildNode = (person: ManagedUser): HierarchyNode => {
    placedIds.add(person.id);
    const unplacedReports = (reportsByManagerId.get(person.id) ?? [])
      .filter((report) => !placedIds.has(report.id))
      .sort(compareByRankThenName);
    const children: HierarchyNode[] = [];
    for (const report of unplacedReports) {
      // Se vuelve a comprobar: un hermano anterior pudo haber colocado a esta persona.
      if (!placedIds.has(report.id)) children.push(buildNode(report));
    }
    return { person, children };
  };

  const directReports: HierarchyNode[] = [];
  const directReportPeople = (reportsByManagerId.get(actorId) ?? []).sort(compareByRankThenName);
  for (const person of directReportPeople) {
    if (!placedIds.has(person.id)) directReports.push(buildNode(person));
  }

  // Lo que no se alcanzó desde la raíz: responsable ausente de la lista, o ciclo.
  const detached: HierarchyNode[] = [];
  const unplacedPeople = people
    .filter((person) => !placedIds.has(person.id))
    .sort(compareByRankThenName);
  for (const person of unplacedPeople) {
    if (!placedIds.has(person.id)) detached.push(buildNode(person));
  }

  return { directReports, detached };
}
