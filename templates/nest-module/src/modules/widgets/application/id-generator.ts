/** Port for new identities, so use cases stay deterministic in tests. */
export abstract class IdGenerator {
  /** A new unique id. */
  abstract next(): string;
}
