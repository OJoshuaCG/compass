import type { Mailer } from '../../notification/index.js';
import type { AdministratorContact, AdministratorNotifier } from '../application/recover-root.js';

/** Avisa a los Administradores por el mismo correo que usa la API cuando se usa un código de emergencia. */
export class MailerAdministratorNotifier implements AdministratorNotifier {
  constructor(private readonly mailer: Mailer) {}

  async notify(
    administrators: readonly AdministratorContact[],
    recoveredAt: Date,
  ): Promise<number> {
    const results = await Promise.allSettled(
      administrators.map((administrator) =>
        this.mailer.sendEmergencyAlert({
          to: administrator.email,
          locale: administrator.locale,
          usedAt: recoveredAt,
        }),
      ),
    );
    return results.filter((result) => result.status === 'rejected').length;
  }
}
