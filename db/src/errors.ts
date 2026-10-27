/** A migration file that was already applied has different content now. */
export class MigrationChecksumError extends Error {
  constructor(
    readonly migration: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Migration ${migration} was already applied but its content changed ` +
        `(applied checksum ${expected}, file checksum ${actual}). ` +
        `Applied migrations are never edited: revert the file and create a new migration instead.`,
    );
    this.name = 'MigrationChecksumError';
  }
}

/** The set of migration files is inconsistent with what the database recorded. */
export class MigrationOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationOrderError';
  }
}
