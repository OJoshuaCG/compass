import { bigint, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../../../shared/infrastructure/drizzle-bytea.js';
import type { AuditMetadata } from '../domain/audit-event.js';

/** Espejo de `audit_events` (db/migrations/0006). `seq`, hashes y `created_at` los fija el trigger. */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  seq: bigint('seq', { mode: 'bigint' }).notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  outcome: text('outcome').notNull(),
  reasonCode: text('reason_code'),
  ip: inet('ip'),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<AuditMetadata>().notNull(),
  prevHash: bytea('prev_hash').notNull(),
  hash: bytea('hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});
