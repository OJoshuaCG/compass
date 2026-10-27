import type {
  GeneratedDataKey,
  KeyManagementPort,
} from '../application/ports/key-management-port.js';

/** KMS falso y determinista para pruebas. Cuenta llamadas y puede simular una caída. */
export class FakeKeyManagement implements KeyManagementPort {
  available = true;
  generateCalls = 0;
  decryptCalls = 0;
  private counter = 0;

  generateDataKey(input: { readonly organizationId: string }): Promise<GeneratedDataKey> {
    this.generateCalls += 1;
    if (!this.available) return Promise.reject(new Error('KMS down'));
    this.counter += 1;
    const plaintext = new Uint8Array(32).fill(this.counter);
    return Promise.resolve({
      plaintext,
      wrapped: this.wrap(input.organizationId, new Uint8Array(plaintext)),
      keyRef: 'fake:1',
    });
  }

  decryptDataKey(input: {
    readonly organizationId: string;
    readonly wrapped: Uint8Array;
    readonly keyRef: string;
  }): Promise<Uint8Array> {
    this.decryptCalls += 1;
    if (!this.available) return Promise.reject(new Error('KMS down'));
    const prefix = new TextEncoder().encode(`${input.organizationId}:`);
    const matches = prefix.every((byte, i) => input.wrapped[i] === byte);
    if (!matches) return Promise.reject(new Error('Encryption context mismatch'));
    return Promise.resolve(new Uint8Array(input.wrapped.subarray(prefix.length)));
  }

  private wrap(organizationId: string, dek: Uint8Array): Uint8Array {
    const prefix = new TextEncoder().encode(`${organizationId}:`);
    const out = new Uint8Array(prefix.length + dek.length);
    out.set(prefix, 0);
    out.set(dek, prefix.length);
    return out;
  }
}
