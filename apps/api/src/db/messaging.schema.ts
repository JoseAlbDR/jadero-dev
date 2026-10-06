// The messaging tables api uses, for drizzle-kit only (drizzle.config.ts): api publishes events
// through the outbox and consumes none yet, so it has no inbox (WP-10 Q1 A). drizzle-kit takes
// file paths, not package names, so this file re-exports from `@jadero/messaging/schema`; the
// `messaging` schema value is what makes it write `CREATE SCHEMA "messaging"`.
export { messaging, outbox } from "@jadero/messaging/schema";
