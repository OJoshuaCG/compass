/**
 * Ceremonias WebAuthn con `@simplewebauthn/server`.
 *
 * Invariantes de seguridad
 * - Siempre exige verificación de la persona (PIN, huella…): una llave de acceso es el segundo
 *   factor completo, no solo presencia.
 * - El origen y el identificador del sitio salen de la configuración, nunca de la petición.
 * - Sin atestación (`none`): no se pide ni se guarda información del fabricante.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type {
  PasskeyRecord,
  VerifiedRegistration,
  WebAuthnEngine,
} from '../application/ports/identity-ports.js';
import type { UserId } from '../../../shared/kernel/index.js';

export interface WebAuthnConfig {
  readonly rpName: string;
  /** Dominio del sitio (sin esquema ni puerto), p. ej. `iam.tuempresa.com`. */
  readonly rpId: string;
  /** Origen exacto del navegador, p. ej. `https://iam.tuempresa.com`. */
  readonly origin: string;
}

const asTransports = (values: readonly string[]): AuthenticatorTransport[] =>
  values as AuthenticatorTransport[];

export class SimpleWebAuthnEngine implements WebAuthnEngine {
  constructor(private readonly config: WebAuthnConfig) {}

  async registrationOptions(input: {
    userId: UserId;
    userName: string;
    existing: readonly { id: string; transports: readonly string[] }[];
  }) {
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: input.userName,
      userID: new TextEncoder().encode(input.userId),
      attestationType: 'none',
      excludeCredentials: input.existing.map((c) => ({ id: c.id, transports: [...c.transports] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    return { options, challenge: options.challenge };
  }

  async verifyRegistration(input: {
    response: unknown;
    expectedChallenge: string;
  }): Promise<VerifiedRegistration | null> {
    try {
      const verification = await verifyRegistrationResponse({
        response: input.response as RegistrationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
      if (!verification.verified) return null;
      const { credential } = verification.registrationInfo;
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ?? [],
      };
    } catch {
      return null;
    }
  }

  async authenticationOptions(input: {
    allowed: readonly { id: string; transports: readonly string[] }[];
  }) {
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: 'required',
      allowCredentials: input.allowed.map((c) => ({
        id: c.id,
        transports: asTransports(c.transports),
      })),
    });
    return { options, challenge: options.challenge };
  }

  async verifyAuthentication(input: {
    response: unknown;
    expectedChallenge: string;
    credential: PasskeyRecord;
  }): Promise<{ newCounter: number } | null> {
    try {
      const verification = await verifyAuthenticationResponse({
        response: input.response as AuthenticationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
        credential: {
          id: input.credential.credentialId,
          publicKey: input.credential.publicKey as Uint8Array<ArrayBuffer>,
          counter: input.credential.counter,
          transports: asTransports(input.credential.transports),
        },
      });
      return verification.verified
        ? { newCounter: verification.authenticationInfo.newCounter }
        : null;
    } catch {
      return null;
    }
  }
}
