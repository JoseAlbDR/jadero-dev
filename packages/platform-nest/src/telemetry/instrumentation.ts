/**
 * The OpenTelemetry entry, loaded before the app:
 * `node --import @jadero/platform-nest/instrumentation dist/main.js`.
 * In ESM every import of `main.js` is evaluated before its first line runs, so libraries can only
 * be patched if the loader hook is registered first, from a separate file (explainer, "OpenTelemetry
 * bootstrap order"). Nest does not exist yet, so this reads its own config with `loadConfig`.
 */
import { register } from "node:module";
import { loadConfig } from "../config/load-config.js";
import { createTelemetrySdk } from "./create-sdk.js";
import { telemetryEnv } from "./telemetry-env.js";
import { setTelemetrySdk } from "./telemetry-state.js";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const sdk = createTelemetrySdk(loadConfig(telemetryEnv));
sdk?.start();
setTelemetrySdk(sdk);
