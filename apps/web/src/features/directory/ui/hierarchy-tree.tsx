import type { Rank, UserStatus } from '@iam/contracts';

import type { HierarchyNode } from '../model/build-hierarchy';

import { PersonCell } from './person-cell';
import { RankBadge } from './rank-badge';

export type HierarchyTreeProps = {
  nodes: readonly HierarchyNode[];
  /** Nombre del rango ya traducido. */
  rankLabel: (rank: Rank) => string;
  /** Texto del estado ya traducido: el estado se comunica con texto, no solo con color. */
  statusLabel: (status: UserStatus) => string;
};

/** Solo se anota el estado cuando no es el normal, para no llenar el árbol de «Activa». */
const UNMARKED_STATUS: UserStatus = 'active';

/**
 * Árbol de responsabilidad como listas anidadas (semántica nativa de listas para lectores de
 * pantalla). La guía vertical es solo decoración: la estructura sale del anidado.
 */
export function HierarchyTree({ nodes, rankLabel, statusLabel }: HierarchyTreeProps) {
  if (nodes.length === 0) return null;
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.person.id}>
          <div className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5">
            <PersonCell displayName={node.person.displayName} />
            <RankBadge rank={node.person.rank} label={rankLabel(node.person.rank)} />
            {node.person.status !== UNMARKED_STATUS ? (
              <span className="text-sm text-text-secondary">{statusLabel(node.person.status)}</span>
            ) : null}
          </div>
          {node.children.length > 0 ? (
            <div className="ml-4 border-l border-border pl-4">
              <HierarchyTree
                nodes={node.children}
                rankLabel={rankLabel}
                statusLabel={statusLabel}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
