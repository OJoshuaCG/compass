/**
 * Rotación de la clave de datos (DEK) de la organización (ADR 0040).
 *
 * Invariantes de seguridad
 * - Exige `platform.manage` (Administrador o Raíz) con reautenticación reciente.
 * - Una rotación por incidente exige además `org.settings` (solo la Raíz).
 * - La auditoría se escribe antes de rotar y en la misma transacción: si no puede registrarse, no se
 *   rota. `rotate()` confirma en su propia transacción; si fallara (otra rotación en curso), la
 *   transacción de esta acción se revierte y la auditoría del éxito no queda.
 * - Rotar no recifra: el recifrado lo hace `ReencryptSecrets` (trabajo `reencrypt`).
 * - Ningún material de clave sale de aquí: solo números de versión.
 */
import { err, ok } from '../../../shared/kernel/index.js';
import type { DomainError, RequestContextReader, Result } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { DataKeyResolver, SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';

export type RotationReason = 'scheduled' | 'incident';

export interface DataKeyRotation {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly reason: RotationReason;
}

interface Dependencies {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly audit: AuditLog;
  readonly keys: DataKeyResolver;
  readonly cipher: SecretCipher;
}

export class RotateDataKey {
  constructor(private readonly deps: Dependencies) {}

  execute(input: {
    readonly reason: RotationReason;
  }): Promise<Result<DataKeyRotation, DomainError>> {
    const { context, uow, authorizer, audit, keys, cipher } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'platform.manage' });
      if (input.reason === 'incident') await authorizer.require({ permission: 'org.settings' });

      const current = context.current();
      const active = await cipher.activeVersion(current.organizationId);
      if (!active.ok) return err(active.error);
      const fromVersion = active.value;

      const recorded = await audit.record({
        action: 'crypto.dek_rotated',
        actorId: current.actorId,
        targetType: 'organization',
        targetId: current.organizationId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { fromVersion, toVersion: fromVersion + 1, reason: input.reason },
      });
      if (!recorded.ok) return err(recorded.error);

      const toVersion = await keys.rotate(current.organizationId);
      if (toVersion !== fromVersion + 1) {
        // Otra rotación se coló entre la lectura y la nuestra: lo auditado arriba era una predicción,
        // así que se deja constancia de la versión real en lugar de dejar un registro engañoso.
        const corrected = await audit.record({
          action: 'crypto.dek_rotated',
          actorId: current.actorId,
          targetType: 'organization',
          targetId: current.organizationId,
          outcome: 'success',
          reasonCode: null,
          ip: null,
          requestId: current.requestId,
          metadata: { fromVersion: toVersion - 1, toVersion, reason: input.reason },
        });
        if (!corrected.ok) return err(corrected.error);
      }
      return ok({ fromVersion, toVersion, reason: input.reason });
    });
  }
}
