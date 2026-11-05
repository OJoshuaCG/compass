/**
 * Retiro de acceso de la Raíz anterior tras una transferencia (implementa el puerto de `directory`).
 *
 * Invariantes de seguridad
 * - Corre en la transacción de la transferencia: cierra todas sus sesiones y revoca su TOTP, sus llaves de
 *   acceso y sus códigos de recuperación ordinarios; no queda ningún factor ni sesión de la Raíz anterior.
 * - No toca los códigos de emergencia: pertenecen a la organización y los anula `provisioning` aparte.
 */
import type { RootAccessRevoker } from '../../directory/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { CredentialRepository, SessionRepository } from './ports/identity-ports.js';

export interface RootAccessRevokerAdapterDeps {
  readonly sessions: Pick<SessionRepository, 'revokeAllOfUser'>;
  readonly credentials: Pick<CredentialRepository, 'revokeSecondFactor'>;
}

export class RootAccessRevokerAdapter implements RootAccessRevoker {
  constructor(private readonly deps: RootAccessRevokerAdapterDeps) {}

  async revokeForReenrollment(userId: UserId, at: Date): Promise<void> {
    await this.deps.sessions.revokeAllOfUser(userId, at);
    await this.deps.credentials.revokeSecondFactor(userId, at);
  }
}
