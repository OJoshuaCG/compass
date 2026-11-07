import { describe, expect, it } from 'vitest';

import { clockAngles } from './clock';

describe('clockAngles', () => {
  it('points both hands at 12 at midnight and noon', () => {
    expect(clockAngles(new Date('2030-01-01T00:00:00Z'), 'UTC')).toEqual({ hour: 0, minute: 0 });
    expect(clockAngles(new Date('2030-01-01T12:00:00Z'), 'UTC')).toEqual({ hour: 0, minute: 0 });
  });

  it('moves the hour hand with the minutes', () => {
    // 3:30 → minutero en las 6 (180°) y horario a medio camino entre las 3 y las 4 (105°).
    expect(clockAngles(new Date('2030-01-01T15:30:00Z'), 'UTC')).toEqual({
      hour: 105,
      minute: 180,
    });
  });

  it('reads the time in the profile time zone, not in UTC', () => {
    // 15:30 UTC son las 9:30 en la Ciudad de México (UTC−6).
    expect(clockAngles(new Date('2030-01-01T15:30:00Z'), 'America/Mexico_City')).toEqual({
      hour: 285,
      minute: 180,
    });
  });
});
