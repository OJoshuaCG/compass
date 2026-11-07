import { Badge } from '@iam/ui';

/** Rango de la raíz de la jerarquía: es el único que se resalta con el acento. */
const ROOT_RANK = 0;

export type RankBadgeProps = {
  rank: number;
  /** Nombre del rango ya traducido. */
  label: string;
};

/** Chip de rango. El texto es el canal principal; el acento solo distingue a la raíz. */
export function RankBadge({ rank, label }: RankBadgeProps) {
  return <Badge tone={rank === ROOT_RANK ? 'accent' : 'neutral'}>{label}</Badge>;
}
