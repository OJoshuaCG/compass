import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { Authorizer, DenialGrouper, PgRoleRepository } from '../src/modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from '../src/modules/audit/index.js';
import { PgUserDirectory } from '../src/modules/directory/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

// ADR 0022: la acción negada se revierte, pero el rastro de la negación debe quedar. Esta prueba
// lo comprueba con PostgreSQL real, sin dobles de la transacción independiente.
let db: TestDatabase;
let organizationId: string;
let operatorId: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let authorizer: Authorizer;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  organizationId = await db.seedOrganization('denial-rollback');
  // Un Operador activo sin ningún rol: existe (la auditoría exige un actor real por clave foránea)
  // pero no tiene el permiso, así que el motor niega con AUTHZ.PERMISSION.
  const root = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status) values ($1, 'root@rollback.test', 'Root', 0, 'active') returning id",
    [organizationId],
  );
  const operator = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, managed_by) values ($1, 'operator@rollback.test', 'Operator', 3, 'active', $2) returning id",
    [organizationId, root.rows[0]?.id],
  );
  operatorId = operator.rows[0]?.id ?? '';
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  const clock = new SystemClock();
  authorizer = new Authorizer({
    context: requestContext,
    directory: new PgUserDirectory(uow),
    roles: new PgRoleRepository(uow),
    audit: new RecordAuditEvent({
      repository: new PgAuditEventRepository(uow),
      context: requestContext,
      ids: new UuidV7Generator(),
    }),
    clock,
    denialGrouper: new DenialGrouper(clock),
    independently: (fn) => uow.runIndependent(fn),
  });
});

afterAll(async () => {
  await db.close();
});

const countDenials = async (requestId: string): Promise<number> => {
  const result = await db.admin.query<{ n: string }>(
    "select count(*) as n from audit_events where organization_id = $1 and action = 'authz.denied' and request_id = $2",
    [organizationId, requestId],
  );
  return Number(result.rows[0]?.n);
};

describe('audited denial and the caller transaction', () => {
  it('keeps the authz.denied event when the caller transaction rolls back', async () => {
    const requestId = `rollback-${String(Date.now())}`;
    const marker = `marker-${requestId}`;

    await expect(
      requestContext.run(
        { ...contextFor(organizationId, requestId), actorId: asUserId(operatorId) },
        () =>
          uow.run(async () => {
            // La acción negada deja su propio cambio en la transacción del llamador...
            await uow
              .current()
              .query(
                "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
                [organizationId, marker],
              );
            // ...el actor no tiene el permiso: el motor niega y audita la negación aparte.
            await authorizer.require({ permission: 'user.update' });
          }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });

    const rolledBack = await db.admin.query<{ n: string }>(
      'select count(*) as n from outbox_events where aggregate = $1',
      [marker],
    );
    expect(rolledBack.rows[0]?.n).toBe('0');
    expect(await countDenials(requestId)).toBe(1);
  });
});
