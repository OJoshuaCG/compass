import type { Clock } from '../kernel/index.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
