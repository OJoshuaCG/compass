/** Ángulos (en grados, desde las 12 y en sentido horario) de las manecillas de un reloj analógico. */
export type ClockAngles = { hour: number; minute: number };

const DEGREES_PER_MINUTE = 6;
const DEGREES_PER_HOUR = 30;
const HOURS_ON_DIAL = 12;

/**
 * Hora y minuto de `date` en `timeZone` (sin ella, la hora del equipo, que es la del navegador),
 * convertidos a ángulos. La aguja de las horas avanza también con los minutos, como en un reloj.
 */
export function clockAngles(date: Date, timeZone?: string): ClockAngles {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(date);
  const read = (type: 'hour' | 'minute'): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const minutes = read('minute');
  const hours = read('hour') % HOURS_ON_DIAL;
  return {
    hour: hours * DEGREES_PER_HOUR + minutes * (DEGREES_PER_HOUR / 60),
    minute: minutes * DEGREES_PER_MINUTE,
  };
}
