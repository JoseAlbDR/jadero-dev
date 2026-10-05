import { type HeartbeatRecord, HeartbeatRepository } from "../application/heartbeat.repository.js";
import {
  HeartbeatInbox,
  type HeartbeatScope,
  HeartbeatUnitOfWork,
  type InboxEvent,
} from "../application/heartbeat.unit-of-work.js";

/** The fake of {@link HeartbeatRepository}: the last ping per source, older never over newer. */
export class InMemoryHeartbeatRepository extends HeartbeatRepository {
  /** @param rows the last ping per source; the unit of work passes a copy it commits or drops. */
  constructor(readonly rows = new Map<string, HeartbeatRecord>()) {
    super();
  }

  /** {@inheritDoc HeartbeatRepository.record} */
  async record(record: HeartbeatRecord): Promise<void> {
    const current = this.rows.get(record.source);
    if (current && Date.parse(current.seenAt) >= Date.parse(record.seenAt)) return;
    this.rows.set(record.source, record);
  }
}

/** The fake of {@link HeartbeatInbox}: a set of `queue` plus event id keys. */
class InMemoryHeartbeatInbox extends HeartbeatInbox {
  constructor(readonly keys: Set<string>) {
    super();
  }

  /** {@inheritDoc HeartbeatInbox.record} */
  async record(queue: string, event: InboxEvent): Promise<boolean> {
    const key = `${queue}:${event.id}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}

/**
 * The fake of {@link HeartbeatUnitOfWork} for unit tests (ADR-009: fakes at ports): each `run`
 * works on copies of the inbox and the heartbeats, which replace the committed state only when the
 * work resolves, so a throwing work leaves nothing, as a Postgres rollback does. Runs are meant to
 * be sequential; overlapping runs would not see each other, which is not what Postgres does.
 */
export class InMemoryHeartbeatUnitOfWork extends HeartbeatUnitOfWork {
  /** Committed inbox keys, `queue:eventId`. */
  inbox = new Set<string>();
  /** Committed last ping per source. */
  heartbeats = new Map<string, HeartbeatRecord>();

  /** {@inheritDoc HeartbeatUnitOfWork.run} */
  async run<T>(work: (scope: HeartbeatScope) => Promise<T>): Promise<T> {
    const inbox = new InMemoryHeartbeatInbox(new Set(this.inbox));
    const heartbeats = new InMemoryHeartbeatRepository(new Map(this.heartbeats));
    const result = await work({ inbox, heartbeats });
    this.inbox = inbox.keys;
    this.heartbeats = heartbeats.rows;
    return result;
  }
}
