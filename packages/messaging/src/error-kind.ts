/**
 * The error's class and code only (`Error (ECONNREFUSED)`): a driver's message can carry values
 * from the query or the payload, and this text ends up in logs, the DLQ header and the outbox.
 * @param error anything thrown.
 * @returns a short description without the message.
 */
export function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return "non-error thrown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number"
    ? `${error.name} (${code})`
    : error.name;
}
