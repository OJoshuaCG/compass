import type { DkimSignatureEvidence, HeaderCounts } from '../../domain/dkim-gate.js';

/** Cabecera de interés en el orden en que aparece en el mensaje (`position` empieza en 0). */
export interface MailHeader {
  /** Nombre en minúsculas. */
  readonly name: string;
  readonly value: string;
  readonly position: number;
}

/** Resultado del análisis MIME (corre en un proceso hijo sin base de datos, KMS ni contraseña). */
export interface ParsedMail {
  readonly fromAddress: string | null;
  readonly toAddresses: readonly string[];
  readonly subject: string | null;
  readonly dateHeader: Date | null;
  readonly headerInstanceCounts: HeaderCounts;
  /** Solo `authentication-results` y `dkim-signature`, con su posición en el mensaje. */
  readonly relevantHeaders: readonly MailHeader[];
  /** Texto plano; el HTML nunca llega aquí. */
  readonly bodyText: string;
}

/** El mensaje no se pudo analizar (formato inválido, tope o tiempo agotado). */
export class MimeParseError extends Error {
  constructor() {
    super('PARSE_ERROR');
    this.name = 'MimeParseError';
  }
}

export interface MimeParser {
  /** Lanza `MimeParseError`; cualquier otro error es un fallo inesperado. */
  parse(rawMessage: Uint8Array): Promise<ParsedMail>;
}

/** Veredictos que el servidor propio anotó; solo se registran para decidir la fase 2 de DKIM. */
export interface AuthenticityVerdicts {
  readonly spf: string | null;
  readonly dkim: string | null;
  readonly dmarc: string | null;
}

export type AuthenticityAssessment =
  | {
      readonly ok: true;
      /** Vacío si ninguna firma pasó con alineación: la compuerta rechaza con `NO_VALID_SIGNATURE`. */
      readonly validatedSignatures: readonly DkimSignatureEvidence[];
      readonly verdicts: AuthenticityVerdicts;
    }
  | {
      readonly ok: false;
      readonly reason: 'AUTH_RESULTS_AMBIGUOUS' | 'DKIM_SIGNATURE_AMBIGUOUS';
    };

/**
 * Interpreta la `Authentication-Results` del servidor propio (fase 1 del ADR 0045): una sola cabecera con
 * el `authserv-id` configurado y en primera posición, y una sola firma candidata. Solo este puerto puede
 * declarar `keyBitsPolicy: 'not_available'`.
 */
export interface AuthenticityVerifier {
  assess(
    mail: ParsedMail,
    context: { readonly authservId: string; readonly fromAddress: string | null },
  ): AuthenticityAssessment;
}
