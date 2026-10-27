import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../../../shared/infrastructure/drizzle-bytea.js';

/** Espejo de `data_keys` (db/migrations/0003): solo la DEK envuelta, nunca en claro. */
export const dataKeys = pgTable('data_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  version: integer('version').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  kmsKeyRef: text('kms_key_ref').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
