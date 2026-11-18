import type { InfrastructureAlertCode } from '../../domain/infrastructure-alert.js';

/** Consulta, en la organización en curso, si ya se encoló una alerta de infraestructura reciente. */
export interface InfrastructureAlertHistory {
  hasAlertSince(code: InfrastructureAlertCode, since: Date): Promise<boolean>;
}
