import type { NodeSDK } from "@opentelemetry/sdk-node";

let current: NodeSDK | undefined;

/** Called by the instrumentation entry once the SDK has started. */
export function setTelemetrySdk(sdk: NodeSDK | undefined): void {
  current = sdk;
}

/** Flushes pending spans and stops the SDK; a no-op when telemetry is off. */
export async function shutdownTelemetry(): Promise<void> {
  const sdk = current;
  current = undefined;
  await sdk?.shutdown();
}
