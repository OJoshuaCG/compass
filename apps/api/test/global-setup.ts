import { bootstrapRoles } from '@iam/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

export const APP_PASSWORD = 'app-test-pw';
export const MIGRATOR_PASSWORD = 'migrator-test-pw';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
  }
}

// Un contenedor para toda la ejecución. Los roles son del clúster: se crean aquí una sola vez
// (archivos en paralelo competirían por `create role`); cada archivo de prueba crea su base.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const adminUrl = container.getConnectionUri();
  await bootstrapRoles({ connectionString: adminUrl });
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`alter role iam_migrator login password '${MIGRATOR_PASSWORD}'`);
    await admin.query(`alter role iam_app login password '${APP_PASSWORD}'`);
  } finally {
    await admin.end();
  }
  project.provide('adminUrl', adminUrl);
  return async () => {
    await container.stop();
  };
}
