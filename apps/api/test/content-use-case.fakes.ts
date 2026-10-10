import { Clock } from "../src/modules/content/application/clock.js";
import type { ContentScope } from "../src/modules/content/application/content.unit-of-work.js";
import { IdGenerator } from "../src/modules/content/application/id-generator.js";
import {
  InMemoryContentStore,
  InMemoryContentUnitOfWork,
} from "../src/modules/content/infrastructure/in-memory-content.unit-of-work.js";

// Fakes at the content module's ports (ADR-009) for the use case tests: a clock that stands still
// until a test moves it, and ids from a counter. The unit of work is the module's own in-memory
// fake, which passes the same contract suite as the Drizzle one.

/** A clock pinned at 2026-10-10T10:00Z until `advance` moves it. */
export class FixedClock extends Clock {
  private ms = Date.UTC(2026, 9, 10, 10, 0);

  /** @returns the pinned time, a new `Date` each call. */
  now(): Date {
    return new Date(this.ms);
  }

  /**
   * Moves the clock forward.
   * @param minutes how far.
   */
  advance(minutes: number): void {
    this.ms += minutes * 60_000;
  }
}

/** UUIDv7-shaped ids from a counter: `0199ffff-0000-7000-8000-000000000001`, then 2, 3 ... */
export class SequenceIds extends IdGenerator {
  private count = 0;

  /** @returns the next id in the sequence. */
  next(): string {
    this.count += 1;
    return `0199ffff-0000-7000-8000-${this.count.toString(16).padStart(12, "0")}`;
  }
}

/** The ports a use case test builds its use cases on, sharing one in-memory store. */
export interface ContentPorts {
  readonly store: InMemoryContentStore;
  readonly uow: InMemoryContentUnitOfWork;
  readonly clock: FixedClock;
  readonly ids: SequenceIds;
  /**
   * Reads committed state the way a use case would, in a run that writes nothing.
   * @param read the read.
   */
  read<T>(read: (scope: ContentScope) => Promise<T>): Promise<T>;
}

/** @returns fresh fakes over an empty store. */
export function contentPorts(): ContentPorts {
  const store = new InMemoryContentStore();
  const uow = new InMemoryContentUnitOfWork(store);
  return {
    store,
    uow,
    clock: new FixedClock(),
    ids: new SequenceIds(),
    read: (read) => uow.run(read),
  };
}
