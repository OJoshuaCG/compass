import { readFileSync } from 'node:fs';

import { PERMISSIONS } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { PERMISSION_CEILING } from './permission-catalog.js';

// Migración que tiene la ÚLTIMA definición de permission_rank_ceiling: 0015 la creó, 0021 la
// redefinió al agregar credential.restore_version y 0023 al agregar los permisos de códigos entrantes. Si otra migración la vuelve a redefinir, hay
// que apuntar aquí a esa, o la prueba compararía contra una definición vieja.
const MIGRATION_URL = new URL(
  '../../../../../../db/migrations/0023_inbound_permissions.sql',
  import.meta.url,
);

/** Lee los pares `when '<permiso>' then <techo>` de la función permission_rank_ceiling. */
function readCeilingsFromMigration(): Record<string, number> {
  const sql = readFileSync(MIGRATION_URL, 'utf8');
  const ceilings: Record<string, number> = {};
  for (const match of sql.matchAll(/when '([a-z_.]+)' then (\d)/g)) {
    const permission = match[1];
    const ceiling = match[2];
    if (permission === undefined || ceiling === undefined) {
      continue;
    }
    ceilings[permission] = Number(ceiling);
  }
  return ceilings;
}

// El techo vive duplicado en TypeScript y en SQL (migración 0015): si se separan, la base
// rechazaría asignaciones que el motor permite, o al revés.
describe('rank ceiling: database and code stay in sync', () => {
  it('has the same permissions and ceilings in SQL as in PERMISSION_CEILING', () => {
    expect(readCeilingsFromMigration()).toEqual(PERMISSION_CEILING);
  });

  it('covers every permission of the contract catalog', () => {
    const inMigration = Object.keys(readCeilingsFromMigration()).sort();
    expect(inMigration).toEqual([...PERMISSIONS].sort());
  });
});
