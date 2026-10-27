import type { Rank } from '@iam/contracts';

export type { Rank };

/** Rangos del plan: un número menor significa más autoridad. */
export const RANK = { ROOT: 0, ADMINISTRATOR: 1, LEADER: 2, OPERATOR: 3 } as const satisfies Record<
  string,
  Rank
>;

export const isRank = (value: number): value is Rank =>
  value === 0 || value === 1 || value === 2 || value === 3;
