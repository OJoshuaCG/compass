import type { OrganizationId } from '../../../shared/kernel/index.js';

/** Versión del formato del manifiesto publicado: el verificador (TODO H1) la lee antes de interpretar el resto. */
export const AUDIT_ANCHOR_FORMAT = 'compass.audit-anchor/v1';

/** Prefijo de los objetos en el bucket inmutable; debajo va una carpeta por organización. */
export const AUDIT_ANCHOR_KEY_PREFIX = 'audit-anchors';

/** Dígitos del número de manifiesto en la clave del objeto: el orden alfabético coincide con el numérico. */
const MANIFEST_NUMBER_DIGITS = 12;

const MICROSECONDS_PER_MILLISECOND = 1000n;

/**
 * Lo que la base de datos asignó al anclar una organización (migración 0033). Ningún campo lo decide la
 * aplicación: el trigger lee la cabeza de la cadena, numera y calcula el hash. Los hashes van en hexadecimal.
 */
export interface AuditAnchor {
  readonly organizationId: OrganizationId;
  readonly manifestNumber: bigint;
  /** `seq` del último evento de auditoría al anclar; 0 si la organización no tenía eventos. */
  readonly anchoredSeq: bigint;
  readonly anchoredHash: string;
  readonly prevManifestHash: string;
  readonly manifestHash: string;
  /** Microsegundos desde la época: es el valor exacto que entra en el hash del manifiesto. */
  readonly anchoredAtMicros: bigint;
}

/** Objeto a publicar: la clave dentro del bucket y el cuerpo JSON. */
export interface AuditAnchorManifest {
  readonly objectKey: string;
  readonly body: string;
}

/**
 * Convierte el ancla en el manifiesto que se publica. Los enteros grandes viajan como texto para que ningún
 * lector los redondee; `anchoredAt` es solo para personas, el verificador usa `anchoredAtMicros`.
 */
export function toAuditAnchorManifest(anchor: AuditAnchor): AuditAnchorManifest {
  const manifestNumberText = anchor.manifestNumber.toString();
  // El hash va en la clave: el destino no admite escritura condicional verificada, y así una nueva escritura con el
  // mismo número (reintento tras un fallo de confirmación, o alguien con la credencial) crea otro objeto en vez de
  // una versión nueva que ocultaría la anterior. Dos objetos con el mismo número son una alerta del verificador.
  const objectKey = `${AUDIT_ANCHOR_KEY_PREFIX}/${anchor.organizationId}/${manifestNumberText.padStart(MANIFEST_NUMBER_DIGITS, '0')}-${anchor.manifestHash}.json`;
  const anchoredAtMilliseconds = Number(anchor.anchoredAtMicros / MICROSECONDS_PER_MILLISECOND);
  const body = JSON.stringify({
    format: AUDIT_ANCHOR_FORMAT,
    organizationId: anchor.organizationId,
    manifestNumber: manifestNumberText,
    anchoredSeq: anchor.anchoredSeq.toString(),
    anchoredHash: anchor.anchoredHash,
    prevManifestHash: anchor.prevManifestHash,
    manifestHash: anchor.manifestHash,
    anchoredAtMicros: anchor.anchoredAtMicros.toString(),
    anchoredAt: new Date(anchoredAtMilliseconds).toISOString(),
  });
  return { objectKey, body };
}
