/**
 * Alta de una organización (comando de operaciones). Se ejecuta UNA vez por organización, con una
 * conexión de administrador, nunca desde la API. Crea la organización, sus roles del sistema y a la
 * persona Raíz con una contraseña inicial de un solo uso, y lo deja en la bitácora.
 *
 * La contraseña inicial se imprime una sola vez por la salida estándar (no pasa por los registros)
 * y la Raíz debe cambiarla en su primer ingreso, antes de registrar su segundo factor.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { Argon2PasswordHasher, ZxcvbnPasswordStrength } from './modules/identity/index.js';
import { NodeCryptoPrimitives } from './modules/crypto/index.js';
import { BootstrapOrganization, PgOrganizationSeeder } from './modules/provisioning/index.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const inputSchema = z.object({
  PROVISION_DATABASE_URL: z.string().min(1),
  ORG_NAME: z.string().trim().min(1).max(200),
  ORG_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  ROOT_EMAIL: z.email(),
  ROOT_NAME: z.string().trim().min(1).max(200),
});

const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  // Solo los nombres de las variables con problema, nunca sus valores.
  const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment: ${names}`);
}
const input = parsed.data;

const pool = new Pool({ connectionString: input.PROVISION_DATABASE_URL, max: 2 });
const primitives = new NodeCryptoPrimitives();
try {
  const result = await new BootstrapOrganization({
    seeder: new PgOrganizationSeeder(pool),
    hasher: new Argon2PasswordHasher(),
    strength: new ZxcvbnPasswordStrength(),
    ids: new UuidV7Generator(),
    randomBytes: (length) => primitives.randomBytes(length),
  }).execute({
    name: input.ORG_NAME,
    slug: input.ORG_SLUG,
    rootEmail: input.ROOT_EMAIL,
    rootDisplayName: input.ROOT_NAME,
  });

  process.stdout.write(
    [
      '',
      'Organización creada.',
      `  Identificador de la organización: ${result.organizationId}`,
      `  Persona Raíz: ${input.ROOT_EMAIL}`,
      `  Contraseña inicial (de un solo uso): ${result.initialPassword ?? ''}`,
      '',
      'Entrégala por un canal seguro. Se muestra solo esta vez y debe cambiarse en el primer ingreso.',
      '',
    ].join('\n'),
  );
} finally {
  await pool.end();
}
