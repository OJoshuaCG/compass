import {
  MAIL_PORT_BY_TLS_MODE,
  MAIL_TLS_MODES,
  putInboundSourceConnectionRequestSchema,
  type InboundSourceConnection,
  type InboundSourceSummary,
  type MailTlsMode,
  type PutInboundSourceConnectionRequest,
} from '@iam/contracts';
import { z } from 'zod';

/** Sin contraseña escrita se conserva la guardada: el campo vacío significa «no cambiar». */
const KEEP_STORED_PASSWORD = '';

/** Los destinatarios se escriben en un solo campo, separados por comas, espacios o saltos de línea. */
const RECIPIENT_SEPARATOR = /[\s,;]+/;

/** Campos del formulario de conexión. Todos son texto para que el formulario no transforme nada. */
export type ConnectionFormValues = {
  host: string;
  tlsMode: MailTlsMode;
  username: string;
  authservId: string;
  recipients: string;
  password: string;
};

export type ConnectionFormField = keyof ConnectionFormValues;

/** Campos del contrato que el formulario edita con otro nombre o sin campo propio. */
const CONTRACT_FIELD_TO_FORM_FIELD: Readonly<Record<string, ConnectionFormField>> = {
  host: 'host',
  // El puerto lo fija el modo TLS (ADR 0045): un puerto inválido solo puede venir del modo.
  port: 'tlsMode',
  tlsMode: 'tlsMode',
  username: 'username',
  authservId: 'authservId',
  acceptedRecipients: 'recipients',
  password: 'password',
};

/** Campo del formulario que corresponde a un campo del contrato (validación local o 422 del servidor). */
export function formFieldOfContractField(contractField: string): ConnectionFormField | undefined {
  return CONTRACT_FIELD_TO_FORM_FIELD[contractField];
}

export type ConnectionRequestOptions = {
  /** Solo MANAGE cambia los destinatarios; con EDIT se omiten y el servidor conserva los guardados. */
  canEditRecipients: boolean;
};

export function parseRecipients(text: string): string[] {
  return text.split(RECIPIENT_SEPARATOR).filter((entry) => entry !== '');
}

/** Cuerpo del PUT sin validar: el puerto sale del modo TLS y la contraseña solo va si se escribió. */
function toRequestCandidate(
  values: ConnectionFormValues,
  options: ConnectionRequestOptions,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    host: values.host,
    port: MAIL_PORT_BY_TLS_MODE[values.tlsMode],
    tlsMode: values.tlsMode,
    username: values.username,
    authservId: values.authservId,
  };
  if (options.canEditRecipients) candidate.acceptedRecipients = parseRecipients(values.recipients);
  if (values.password !== KEEP_STORED_PASSWORD) candidate.password = values.password;
  return candidate;
}

/**
 * Esquema del formulario: valida con el MISMO esquema del contrato que usa el servidor, para que las
 * reglas (host sin IP, puerto por modo, tope de destinatarios) no se dupliquen en la web. Cada
 * incidencia se lleva al campo del formulario que la origina.
 */
export function connectionFormSchema(options: ConnectionRequestOptions) {
  return z
    .object({
      host: z.string(),
      tlsMode: z.enum(MAIL_TLS_MODES),
      username: z.string(),
      authservId: z.string(),
      recipients: z.string(),
      password: z.string(),
    })
    .superRefine((values, context) => {
      const parsed = putInboundSourceConnectionRequestSchema.safeParse(
        toRequestCandidate(values, options),
      );
      if (parsed.success) return;
      for (const issue of parsed.error.issues) {
        const contractField = String(issue.path[0] ?? '');
        const formField = formFieldOfContractField(contractField) ?? 'host';
        // El mensaje del contrato viene en inglés: el formulario lo traduce como «no válido» y la
        // descripción de cada campo explica el formato esperado.
        context.addIssue({ code: 'custom', path: [formField], message: issue.message });
      }
    });
}

/** Cuerpo exacto del PUT, ya validado y normalizado por el contrato (host en minúsculas, recortes). */
export function buildConnectionRequest(
  values: ConnectionFormValues,
  options: ConnectionRequestOptions,
): PutInboundSourceConnectionRequest {
  return putInboundSourceConnectionRequestSchema.parse(toRequestCandidate(values, options));
}

/** Valores iniciales: los guardados, o los de una conexión nueva con la dirección de la fuente. */
export function initialConnectionValues(
  source: InboundSourceSummary,
  connection: InboundSourceConnection | null,
): ConnectionFormValues {
  if (connection === null) {
    return {
      host: '',
      tlsMode: 'tls',
      username: source.address,
      authservId: '',
      recipients: source.address,
      password: KEEP_STORED_PASSWORD,
    };
  }
  return {
    host: connection.host,
    tlsMode: connection.tlsMode,
    username: connection.username,
    authservId: connection.authservId,
    recipients: connection.acceptedRecipients.join(', '),
    password: KEEP_STORED_PASSWORD,
  };
}

/**
 * El servidor borra la contraseña guardada si cambian servidor, modo o usuario y no llega una nueva
 * (una contraseña no debe viajar a un servidor distinto del que la emitió). Se avisa antes de guardar.
 */
export function willClearStoredPassword(
  values: ConnectionFormValues,
  connection: InboundSourceConnection | null,
): boolean {
  if (connection === null || !connection.hasPassword) return false;
  if (values.password !== KEEP_STORED_PASSWORD) return false;
  const hostChanged = values.host.trim().toLowerCase() !== connection.host;
  const tlsModeChanged = values.tlsMode !== connection.tlsMode;
  const usernameChanged = values.username.trim() !== connection.username;
  return hostChanged || tlsModeChanged || usernameChanged;
}

/** Comodidad para ofrecer la acción; el servidor decide siempre. Solo el correo tiene conexión IMAP. */
export function canEditConnection(source: InboundSourceSummary): boolean {
  const hasEditLevel = source.level === 'EDIT' || source.level === 'MANAGE';
  return source.status !== 'archived' && source.channel === 'mail' && hasEditLevel;
}

export function canEditRecipients(source: InboundSourceSummary): boolean {
  return source.level === 'MANAGE';
}
