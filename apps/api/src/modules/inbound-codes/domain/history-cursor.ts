/**
 * Cursor opaco del historial de recepciones. Es un par (momento de recepción, id) en base64url: el id
 * desempata recepciones del mismo instante para que ninguna se repita ni se omita entre páginas. El
 * cliente lo trata como una cadena sin significado; un cursor mal formado se rechaza, nunca se adivina.
 */
const CURSOR_PATTERN =
  /^(?<receivedAt>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Un cursor legítimo mide unos 60 caracteres; más que esto es basura y no se decodifica. */
const MAX_ENCODED_CURSOR_LENGTH = 128;

export interface HistoryCursor {
  readonly receivedAt: Date;
  readonly id: string;
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(`${cursor.receivedAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeHistoryCursor(encoded: string): HistoryCursor | null {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_CURSOR_LENGTH) return null;
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  const groups = CURSOR_PATTERN.exec(decoded)?.groups;
  const receivedAtText = groups?.['receivedAt'];
  const id = groups?.['id'];
  if (receivedAtText === undefined || id === undefined) return null;
  const receivedAt = new Date(receivedAtText);
  if (Number.isNaN(receivedAt.getTime())) return null;
  // Un valor que no se reproduce igual (31 de febrero, por ejemplo) no es un cursor emitido por nosotros.
  if (receivedAt.toISOString() !== receivedAtText) return null;
  return { receivedAt, id };
}
