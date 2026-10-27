/** Genera identificadores (UUIDv7 en producción). */
export interface IdGenerator {
  next(): string;
}
