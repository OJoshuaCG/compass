import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { bootstrapRoles } from '../src/index.js';
import { Client } from 'pg';

const PASSWORDS = {
  iam_migrator: 'migrator-test-pw',
  iam_app: 'app-test-pw',
  iam_inbound_worker: 'inbound-worker-test-pw',
} as const;

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
  }
}

// One container for the whole run. Roles are cluster-wide, so they are provisioned here once
// (parallel test files would otherwise race on `create role`); each file gets its own database.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const adminUrl = container.getConnectionUri();
  await bootstrapRoles({ connectionString: adminUrl });
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const [role, password] of Object.entries(PASSWORDS)) {
      await admin.query(`alter role ${role} login password '${password}'`);
    }
  } finally {
    await admin.end();
  }
  project.provide('adminUrl', adminUrl);
  return async () => {
    await container.stop();
  };
}
