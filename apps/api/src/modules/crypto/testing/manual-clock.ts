import type { Clock } from '../../../shared/kernel/index.js';

/** Reloj controlable para probar TTL sin esperar. */
export class ManualClock implements Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
