// Run by telemetry.test.ts with `node --import dist/telemetry/instrumentation.js`: one HTTP request
// to a plain server that logs with pino, then exit. http and pino are imported after the hook.
import { createServer } from "node:http";
import pino from "pino";

const logger = pino();
const server = createServer((_req, res) => {
  logger.info("handled");
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  // The query string must never reach a printed span (telemetry.test.ts, pretty exporter).
  await fetch(`http://127.0.0.1:${port}/smoke?token=abc`);
  server.close();
});
