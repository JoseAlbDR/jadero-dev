/**
 * Structured logging, the shape pino's logger already has: fields first, then the message. Fields
 * carry ids, types, counts and error kinds, never a message body (AGENTS.md section 7).
 */
export interface MessagingLog {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}
