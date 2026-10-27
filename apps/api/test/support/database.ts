import { randomUUID } from 'node:crypto';

import { bootstrapRoles, migrate } from '@iam/db';
import { Client, Pool } from 'pg';

import { APP_PASSWORD, MIGRATOR_PASSWORD } from '../global-setup.js';

export interface TestDatabase {
  readonly adminUrl: string;
  readonly appUrl: string;
  /** Pool con el rol de la aplicación (sin BYPASSRLS), el que usa el código bajo prueba. */
  readonly appPool: Pool;
  /** Pool pequeño y separado para `UnitOfWork.runIndependent` (nunca compite con `appPool`). */
  readonly independentPool: Pool;
  /** Conexión de administrador, solo para sembrar datos y para inspeccionar lo almacenado. */
  admin: Client;
  seedOrganization(slug: string): Promise<string>;
  close(): Promise<void>;
}

function withCredentials(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** Crea una base nueva, la migra como `iam_migrator` (igual que producción) y abre los pools. */
export async function createTestDatabase(clusterAdminUrl: string): Promise<TestDatabase> {
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const root = new Client({ connectionString: clusterAdminUrl });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();

  const cluster = new URL(clusterAdminUrl);
  const adminUrl = withCredentials(clusterAdminUrl, cluster.username, cluster.password, name);
  await bootstrapRoles({ connectionString: adminUrl });
  await migrate({
    connectionString: withCredentials(clusterAdminUrl, 'iam_migrator', MIGRATOR_PASSWORD, name),
  });

  const appUrl = withCredentials(clusterAdminUrl, 'iam_app', APP_PASSWORD, name);
  const appPool = new Pool({ connectionString: appUrl, max: 8 });
  const independentPool = new Pool({ connectionString: appUrl, max: 2 });
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  return {
    adminUrl,
    appUrl,
    appPool,
    independentPool,
    admin,
    async seedOrganization(slug: string): Promise<string> {
      const result = await admin.query<{ id: string }>(
        'insert into organizations (name, slug) values ($1, $2) returning id',
        [`Org ${slug}`, slug],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('seed failed');
      return id;
    },
    async close(): Promise<void> {
      await appPool.end();
      await independentPool.end();
      await admin.end();
    },
  };
}
