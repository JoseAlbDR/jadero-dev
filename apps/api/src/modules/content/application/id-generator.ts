/**
 * Port for new identities (WP-10 rule: UUIDv7 from code), an abstract class so it is also the DI
 * token (ADR-003). Use cases take item and revision ids from here, so tests stay deterministic.
 * CV bullets and knowledge entries keep the human ids the owner chooses and never use it for those.
 */
export abstract class IdGenerator {
  /** A new unique id. */
  abstract next(): string;
}
