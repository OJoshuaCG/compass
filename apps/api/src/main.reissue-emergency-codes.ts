/**
 * Reemisión de los códigos de emergencia de la Raíz tras una transferencia (comando de operaciones,
 * ADR 0048). Se ejecuta con una conexión de administrador, nunca desde la API, y solo cuando la Raíz no
 * tiene códigos vigentes (la transferencia los anuló todos).
 *
 * Los códigos nuevos se imprimen una sola vez por la salida estándar (no pasan por los registros).
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { NodeCryptoPrimitives } from './modules/crypto/index.js';
import {
  EmergencyCodeReissueRejectedError,
  PgEmergencyCodeReissueStore,
  ReissueEmergencyCodes,
} from './modules/provisioning/index.js';

const inputSchema = z.object({
  PROVISION_DATABASE_URL: z.string().min(1),
  ORG_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
});

const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment: ${names}`);
}
const input = parsed.data;

const pool = new Pool({ connectionString: input.PROVISION_DATABASE_URL, max: 2 });
const primitives = new NodeCryptoPrimitives();
try {
  const result = await new ReissueEmergencyCodes({
    store: new PgEmergencyCodeReissueStore(pool),
    primitives: {
      randomBytes: (length) => primitives.randomBytes(length),
      sha256: (data) => primitives.sha256(data),
    },
  }).execute({ organizationSlug: input.ORG_SLUG });

  const codesOf = (group: 'A' | 'B'): string[] =>
    result.emergencyCodes
      .filter((_code, index) => result.emergencyCodeGroups[index] === group)
      .map((code) => `  ${code}`);

  process.stdout.write(
    [
      '',
      'Códigos de emergencia NUEVOS. Cada custodio recibe SOLO los de su grupo:',
      '',
      'Custodio A:',
      ...codesOf('A'),
      '',
      'Custodio B:',
      ...codesOf('B'),
      '',
      'Imprímelos AHORA y repártelos fuera del sistema. Se muestran solo esta vez.',
      '',
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof EmergencyCodeReissueRejectedError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await pool.end();
}
