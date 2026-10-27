/**
 * Invariantes de seguridad
 * - Solo usa las funciones `auth.*` (SECURITY DEFINER, columnas mínimas, `search_path` fijo): el rol
 *   de la aplicación no lee tablas sin organización (ADR 0021).
 * - No abre transacción con `app.org_id`: la organización todavía no se conoce.
 */
import type { Pool } from 'pg';

import { asOrganizationId, asUserId, isRank } from '../../../shared/kernel/index.js';
import type {
  LoginRow,
  PreAuthInvitation,
  PreAuthLookup,
  PreAuthSession,
} from '../application/ports/identity-ports.js';

interface LoginDbRow {
  user_id: string;
  organization_id: string;
  status: LoginRow['status'];
  argon2_hash: string | null;
}

interface InvitationDbRow {
  invitation_id: string;
  organization_id: string;
  email: string;
  rank: number;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

interface SessionDbRow {
  session_id: string;
  organization_id: string;
  user_id: string;
  user_status: LoginRow['status'];
  expires_at: Date;
  revoked_at: Date | null;
  mfa_at: Date | null;
  reauth_at: Date | null;
  last_seen_at: Date;
}

export class PgPreAuthLookup implements PreAuthLookup {
  constructor(private readonly pool: Pool) {}

  async findLoginByEmail(email: string): Promise<LoginRow | null> {
    const result = await this.pool.query<LoginDbRow>('select * from auth.find_login_by_email($1)', [
      email,
    ]);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      userId: asUserId(row.user_id),
      organizationId: asOrganizationId(row.organization_id),
      status: row.status,
      argon2Hash: row.argon2_hash,
    };
  }

  async findInvitationByTokenHash(tokenHash: Uint8Array): Promise<PreAuthInvitation | null> {
    const result = await this.pool.query<InvitationDbRow>(
      'select * from auth.find_invitation_by_token_hash($1)',
      [Buffer.from(tokenHash)],
    );
    const row = result.rows[0];
    if (row === undefined || !isRank(row.rank) || row.rank === 0) return null;
    return {
      invitationId: row.invitation_id,
      organizationId: asOrganizationId(row.organization_id),
      email: row.email,
      rank: row.rank,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
    };
  }

  async findSessionByTokenHash(tokenHash: Uint8Array): Promise<PreAuthSession | null> {
    const result = await this.pool.query<SessionDbRow>(
      'select * from auth.find_session_by_token_hash($1)',
      [Buffer.from(tokenHash)],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      sessionId: row.session_id,
      organizationId: asOrganizationId(row.organization_id),
      userId: asUserId(row.user_id),
      userStatus: row.user_status,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      mfaAt: row.mfa_at,
      reauthAt: row.reauth_at,
      lastSeenAt: row.last_seen_at,
    };
  }
}
