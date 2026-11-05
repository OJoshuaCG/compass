/**
 * Panel de la Raíz para elegir por qué canales recibe las alertas de infraestructura: correo y/o Telegram
 * (decisión del dueño del 2026-11-04).
 *
 * Invariantes de seguridad
 * - Leer y cambiar piden `alerts.infra.manage` (solo Raíz). El catálogo le exige reautenticación reciente y
 *   auditoría crítica; el autorizador lo hace cumplir antes de cualquier lectura o escritura, y audita la
 *   negación.
 * - Todo lo que puede responder con `err` va ANTES de la primera escritura: la unidad de trabajo confirma
 *   cualquier retorno que no lance.
 * - La auditoría es el último paso y solo lleva los dos booleanos y la versión.
 */
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { hasAtLeastOneChannel } from '../domain/alert-settings.js';
import type { AlertSettingsRecord, InfrastructureAlertChannels } from '../domain/alert-settings.js';
import type { AlertSettingsStore } from './ports/alert-settings-store.js';

const ALERT_SETTINGS_PERMISSION: Permission = 'alerts.infra.manage';
const AUDIT_TARGET_TYPE = 'alert_settings';

export interface ManageAlertSettingsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly settings: AlertSettingsStore;
  readonly audit: AuditLog;
}

export interface UpdateAlertSettingsInput {
  readonly infrastructure: InfrastructureAlertChannels;
  /** Versión que la persona vio al abrir el panel; 0 si todavía no había ajuste guardado. */
  readonly expectedVersion: number;
}

export class ManageAlertSettings {
  constructor(private readonly deps: ManageAlertSettingsDeps) {}

  get(): Promise<Result<AlertSettingsRecord, DomainError>> {
    const { uow, authorizer, settings } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: ALERT_SETTINGS_PERMISSION });
      return ok(await settings.find());
    });
  }

  update(input: UpdateAlertSettingsInput): Promise<Result<AlertSettingsRecord, DomainError>> {
    const { uow, authorizer, settings, audit, context } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: ALERT_SETTINGS_PERMISSION });
      const actorId = this.requireActorId();

      if (!hasAtLeastOneChannel(input.infrastructure)) {
        return err(
          new DomainError(
            'INTEGRATIONS.ALERT_CHANNEL_REQUIRED',
            'At least one infrastructure alert channel must stay enabled',
          ),
        );
      }

      const saved = await settings.save({
        infrastructure: input.infrastructure,
        updatedBy: actorId,
        expectedVersion: input.expectedVersion,
      });
      if (saved === null) {
        return err(new DomainError('CONFLICT.VERSION', 'Alert settings changed meanwhile'));
      }

      await audit.record({
        action: 'integration.alert_settings_updated',
        actorId,
        targetType: AUDIT_TARGET_TYPE,
        targetId: null,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: {
          infraEmail: saved.infrastructure.email,
          infraTelegram: saved.infrastructure.telegram,
          version: saved.version,
        },
      });
      return ok(saved);
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}
