import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Payload } from "@nestjs/microservices";
import { McpController, McpStrategy, StreamableHttpTransport, Tool } from "@rekog/mcp-nest";
import { z } from "zod";

const ProfileQuery = z.object({ topic: z.enum(["backend", "testing", "infra"]) });

@McpController()
export class ProfileTools {
  /** One read-only tool whose input is a Zod 4 schema. */
  @Tool({
    name: "profile-skills",
    description: "Lists the owner's skills for a topic",
    parameters: ProfileQuery,
  })
  skills(@Payload() { topic }: z.infer<typeof ProfileQuery>): {
    content: { type: "text"; text: string }[];
  } {
    return { content: [{ type: "text", text: JSON.stringify({ topic, skills: ["spike"] }) }] };
  }
}

const mcp = new McpStrategy({
  name: "jadero-spike",
  version: "0.0.0",
  transports: [
    new StreamableHttpTransport({
      endpoint: "/mcp",
      statefulMode: false,
      enableJsonResponse: true,
    }),
  ],
});

@Module({ controllers: [ProfileTools] })
export class AppModule {}

const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
mcp.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy: mcp });
await app.startAllMicroservices();
await app.listen(3906, "127.0.0.1");

const rpc = async (id: number, method: string, params: unknown): Promise<string> => {
  const res = await fetch("http://127.0.0.1:3906/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return `${res.status} ${(await res.text()).slice(0, 400)}`;
};

console.log(
  "initialize ->",
  await rpc(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "spike", version: "0" },
  }),
);
console.log("tools/list ->", await rpc(2, "tools/list", {}));
console.log(
  "tools/call ->",
  await rpc(3, "tools/call", { name: "profile-skills", arguments: { topic: "backend" } }),
);
console.log(
  "tools/call bad input ->",
  await rpc(4, "tools/call", { name: "profile-skills", arguments: { topic: "x" } }),
);
await app.close();
