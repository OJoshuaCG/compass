import type { RequestContextReader, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { Mailer, SecurityNoticeKind } from '../../notification/index.js';
import type { UnitOfWork } from '../../organization/index.js';

/**
 * Tope de espera del envío. Los tiempos de conexión del SMTP suman hasta ~40 s y la persona ya
 * tiene su cambio confirmado: no debe esperar un correo del que no depende.
 */
export const SECURITY_NOTICE_TIMEOUT_MS = 5_000;

/** Lo necesario para avisar a la persona de un cambio en sus factores (TODO G5). */
export interface SecurityNoticePlan {
  readonly kind: SecurityNoticeKind;
  readonly userId: UserId;
  readonly to: string;
  readonly locale: 'es-MX' | 'en-US';
  readonly occurredAt: Date;
  readonly requestId: string;
}

export interface SecurityNoticeDeps {
  readonly mailer: Mailer;
  readonly uow: UnitOfWork;
  readonly audit: AuditLog;
  readonly context: RequestContextReader;
  /**
   * Se invoca cuando el aviso no salió Y tampoco se pudo dejar el evento de auditoría: es la única
   * huella de ese doble fallo. Recibe solo el tipo de aviso, nunca el destinatario.
   */
  readonly reportLost?: ((kind: SecurityNoticeKind) => void) | undefined;
}

const sendWithTimeout = async (send: () => Promise<void>, timeoutMs: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Security notice timed out'));
    }, timeoutMs);
  });
  try {
    await Promise.race([send(), expired]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Mejor esfuerzo, ya confirmado el cambio: un fallo del correo no debe deshacer ni bloquear la
 * acción que se avisa (la persona ya recibió su sesión o su llave). Si el envío falla o excede el
 * tope queda un evento de auditoría con el tipo de aviso, nunca el destinatario. Nunca lanza.
 */
export async function sendSecurityNotice(
  deps: SecurityNoticeDeps,
  plan: SecurityNoticePlan,
): Promise<void> {
  try {
    await sendWithTimeout(
      () =>
        deps.mailer.sendSecurityNotice({
          to: plan.to,
          locale: plan.locale,
          kind: plan.kind,
          occurredAt: plan.occurredAt,
        }),
      SECURITY_NOTICE_TIMEOUT_MS,
    );
  } catch {
    try {
      await deps.uow.run(() =>
        deps.audit.record({
          action: 'auth.security_notice_failed',
          actorId: plan.userId,
          targetType: 'user',
          targetId: plan.userId,
          outcome: 'failure',
          reasonCode: null,
          ip: null,
          requestId: plan.requestId,
          metadata: { kind: plan.kind },
        }),
      );
    } catch {
      // El cambio ya se confirmó y no se rompe la respuesta por esto, pero el doble fallo no puede
      // quedar mudo: se reporta sin destinatario.
      deps.reportLost?.(plan.kind);
    }
  }
}
