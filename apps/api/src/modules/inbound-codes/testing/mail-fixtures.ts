/** Constructores de datos de prueba para el dominio de códigos entrantes: un mensaje válido y variantes. */
import type { DkimGateInput, DkimSignatureEvidence } from '../domain/dkim-gate.js';
import type { InboundMailMessage } from '../domain/inbound-evaluation.js';
import type { InboundTemplate } from '../domain/inbound-template.js';

export const FIXTURE_NOW = new Date('2026-10-30T12:00:00.000Z');
export const FIXTURE_ALIAS = 'cuenta-1@alias.example.test';
export const FIXTURE_SENDER = 'security@facebook.com';
export const FIXTURE_SENDER_DOMAIN = 'facebook.com';
export const FIXTURE_SUBJECT = 'Tu código de acceso';
export const FIXTURE_CODE = '482913';
export const FIXTURE_FINGERPRINT = 'a'.repeat(64);

/** Firma válida: sobrefirma From y Subject, firma Date y To, sin `l=`, clave de 2048 y alineada. */
export function buildSignature(
  overrides: Partial<DkimSignatureEvidence> = {},
): DkimSignatureEvidence {
  return {
    signingDomain: FIXTURE_SENDER_DOMAIN,
    signedHeaderCounts: { from: 2, to: 1, subject: 2, date: 1 },
    hasBodyLengthLimit: false,
    signedAt: new Date('2026-10-30T11:59:30.000Z'),
    expiresAt: new Date('2026-10-30T13:00:00.000Z'),
    keyBits: 2048,
    ...overrides,
  };
}

export function buildGateInput(overrides: Partial<DkimGateInput> = {}): DkimGateInput {
  return {
    sourceAlias: FIXTURE_ALIAS,
    now: FIXTURE_NOW,
    fromAddress: FIXTURE_SENDER,
    toAddresses: [FIXTURE_ALIAS],
    headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 1 },
    validatedSignatures: [buildSignature()],
    ...overrides,
  };
}

export function buildMessage(overrides: Partial<InboundMailMessage> = {}): InboundMailMessage {
  return {
    sourceAlias: FIXTURE_ALIAS,
    receivedAt: FIXTURE_NOW,
    fingerprint: FIXTURE_FINGERPRINT,
    fromAddress: FIXTURE_SENDER,
    toAddresses: [FIXTURE_ALIAS],
    headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 1 },
    subject: FIXTURE_SUBJECT,
    dateHeader: new Date('2026-10-30T11:59:40.000Z'),
    validatedSignatures: [buildSignature()],
    body: `Hola.\nTu código es: ${FIXTURE_CODE}\nNo lo compartas.`,
    ...overrides,
  };
}

export function buildLoginCodeTemplate(overrides: Partial<InboundTemplate> = {}): InboundTemplate {
  return {
    id: 'facebook-login-code',
    kind: 'login_code',
    senderAddress: FIXTURE_SENDER,
    subject: { mode: 'equals', value: FIXTURE_SUBJECT },
    extraction: {
      type: 'fixed_length_code',
      leadingLiteral: 'Tu código es: ',
      codeLength: 6,
      charset: 'digits',
      trailingLiteral: '',
    },
    ...overrides,
  };
}

export function buildResetLinkTemplate(overrides: Partial<InboundTemplate> = {}): InboundTemplate {
  return {
    id: 'facebook-reset-link',
    kind: 'reset_link',
    senderAddress: FIXTURE_SENDER,
    subject: { mode: 'prefix', value: 'Restablece' },
    extraction: {
      type: 'allowed_host_link',
      allowedHosts: ['www.facebook.com'],
      pathPrefix: '/recover',
    },
    ...overrides,
  };
}
