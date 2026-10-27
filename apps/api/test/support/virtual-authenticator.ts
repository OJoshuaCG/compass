import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * Autenticador de software para pruebas: genera atestaciones `none` y firmas ES256 válidas según la
 * especificación de WebAuthn, para ejercitar las ceremonias reales del servidor sin un navegador.
 */

// --- CBOR mínimo (lo justo para el objeto de atestación y la llave COSE) --------------------------

type Cbor = number | string | Buffer | Map<Cbor, Cbor>;

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  return Buffer.from([(major << 5) | 25, value >> 8, value & 0xff]);
}

function encode(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, text.length), text]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  const parts: Buffer[] = [head(5, value.size)];
  for (const [k, v] of value) parts.push(encode(k), encode(v));
  return Buffer.concat(parts);
}

const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();
const b64 = (data: Buffer): string => data.toString('base64url');

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
}
export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: { id: string }[];
}

export interface AuthenticatorFlags {
  /** Verificación de la persona (PIN, huella…). Por defecto sí. */
  userVerified?: boolean;
}

export class VirtualAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  counter = 0;

  constructor(private readonly origin: string) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x ?? '', 'base64url');
    this.y = Buffer.from(jwk.y ?? '', 'base64url');
  }

  get id(): string {
    return b64(this.credentialId);
  }

  /** Respuesta de registro (`navigator.credentials.create`) en el formato JSON del navegador. */
  register(options: RegistrationOptions, flags: AuthenticatorFlags = {}) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const cose = encode(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, this.x],
        [-3, this.y],
      ]),
    );
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(options.rp.id),
      Buffer.from([0x01 | (flags.userVerified === false ? 0 : 0x04) | 0x40]),
      Buffer.alloc(4),
      Buffer.alloc(16), // AAGUID
      credentialIdLength,
      this.credentialId,
      cose,
    ]);
    const attestationObject = encode(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map<Cbor, Cbor>()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Respuesta de autenticación (`navigator.credentials.get`); firma con la llave privada. */
  authenticate(
    options: AuthenticationOptions,
    overrides: { counter?: number; userVerified?: boolean; signWith?: KeyObject } = {},
  ) {
    this.counter += 1;
    const counter = overrides.counter ?? this.counter;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(counter);
    const authenticatorData = Buffer.concat([
      sha256(options.rpId),
      Buffer.from([0x01 | (overrides.userVerified === false ? 0 : 0x04)]),
      counterBytes,
    ]);
    const signature = createSign('sha256')
      .update(Buffer.concat([authenticatorData, sha256(clientDataJSON)]))
      .sign({ key: overrides.signWith ?? this.privateKey, dsaEncoding: 'der' });
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authenticatorData),
        signature: b64(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Una llave privada ajena, para probar firmas que no corresponden a la credencial. */
  static foreignKey(): KeyObject {
    return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  }
}
