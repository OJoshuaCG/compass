/**
 * Resume un `User-Agent` en "Navegador · Sistema" para reconocer el dispositivo de un vistazo.
 * Es una heurística de presentación (el valor es declarado por el cliente y no autentica nada):
 * ante lo que no reconoce devuelve `undefined` y la UI muestra "dispositivo desconocido". El
 * orden importa: Edge y Chrome también dicen "Safari", y Android también dice "Linux".
 */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux|X11/, 'Linux'],
];

const first = (table: readonly (readonly [RegExp, string])[], userAgent: string) =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

export function describeDevice(userAgent: string | null): string | undefined {
  if (userAgent === null) return undefined;
  const parts = [first(BROWSERS, userAgent), first(SYSTEMS, userAgent)].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
