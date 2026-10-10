/**
 * Port for the current time (implementation choice "Clock"), an abstract class so it is also the
 * DI token (ADR-003): revision, publish and approval times come from here, so tests pin them.
 */
export abstract class Clock {
  /** The current time, a new `Date` on every call. */
  abstract now(): Date;
}
