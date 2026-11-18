import type { RequestContextReader } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { openSmtpPassword } from './open-smtp-password.js';
import type { SmtpConnectionFields, SmtpSettingsStore } from './ports/smtp-settings-store.js';

export interface ResolvedSmtp {
  readonly connection: SmtpConnectionFields;
  readonly password: string;
}

export interface ResolveOrganizationSmtpDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly settings: SmtpSettingsStore;
  readonly cipher: Pick<SecretCipher, 'decrypt'>;
}

/**
 * Lee el servidor SMTP activo de la organización del contexto y abre su contraseña, para que el correo
 * saliente lo use (ADR 0047, enmienda del 2026-11-17). No autoriza: lo invoca el sistema al enviar un
 * aviso que otra operación ya autorizó; la configuración se escribe solo por `ManageSmtpSettings`.
 *
 * - Sin servidor activo, o activo sin contraseña guardada, devuelve `null` y se usa el de las variables de
 *   entorno. Una configuración incompleta no deja a la organización sin correo.
 * - Una contraseña que no se abre LANZA: es un fallo del servicio de llaves, y enviar por otro servidor
 *   cambiaría el remitente sin que nadie lo decida. El outbox reintenta.
 */
export class ResolveOrganizationSmtp {
  constructor(private readonly deps: ResolveOrganizationSmtpDeps) {}

  resolve(): Promise<ResolvedSmtp | null> {
    const { uow, settings, cipher, context } = this.deps;
    return uow.run(async () => {
      const active = await settings.findActive();
      if (active === null) return null;
      const stored = await settings.findPassword(active.id);
      if (stored === null) return null;
      const password = await openSmtpPassword(
        cipher,
        context.current().organizationId,
        active.id,
        stored,
      );
      return {
        connection: {
          host: active.host,
          port: active.port,
          security: active.security,
          username: active.username,
          fromAddress: active.fromAddress,
        },
        password,
      };
    });
  }
}
