import type { DestinationStream } from "pino";

/** A pino destination that keeps every line as parsed JSON, for assertions. */
export function memoryStream(): DestinationStream & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write(chunk: string) {
      for (const line of chunk.split("\n").filter(Boolean)) lines.push(JSON.parse(line));
    },
  };
}
