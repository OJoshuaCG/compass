import { uuidv7 } from 'uuidv7';

import type { IdGenerator } from '../kernel/index.js';

/** UUIDv7: ordenable por tiempo y sin exponer conteos (PostgreSQL 17 no lo genera de forma nativa). */
export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
