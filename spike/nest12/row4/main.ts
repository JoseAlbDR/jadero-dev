import "reflect-metadata";
import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  AllowAnonymous,
  AuthModule,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";

const BASE = "http://127.0.0.1:3904";

// In-memory store so the spike needs no Postgres. The secret is a throwaway dev string.
const db: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
const auth = betterAuth({
  baseURL: BASE,
  secret: "spike-only-not-a-secret-0123456789abcdef",
  database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
});

@Controller()
export class SpikeController {
  @Get("me")
  me(@Session() session: UserSession): { email: string } {
    return { email: session.user.email };
  }

  @AllowAnonymous()
  @Post("echo")
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

@Module({ imports: [AuthModule.forRoot({ auth })], controllers: [SpikeController] })
export class AppModule {}

const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn"] });
await app.listen(3904, "127.0.0.1");

const show = async (label: string, res: Response): Promise<void> =>
  console.log(label, res.status, (await res.text()).slice(0, 160));

await show("GET /api/auth/ok ->", await fetch(`${BASE}/api/auth/ok`));
await show("GET /me (no session) ->", await fetch(`${BASE}/me`));
await show(
  "POST /echo (anonymous, JSON body re-parsed) ->",
  await fetch(`${BASE}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  }),
);
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({
    email: "spike@example.test",
    password: "spike-password-123",
    name: "Spike",
  }),
});
const cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";
console.log("POST /api/auth/sign-up/email ->", signUp.status, "cookie set:", cookie.length > 0);
await show("GET /me (with session) ->", await fetch(`${BASE}/me`, { headers: { cookie } }));
await app.close();

// Fallback path named in the table: mount toNodeHandler on the Express instance directly.
@Module({})
class FallbackModule {}
const plain = await NestFactory.create(FallbackModule, { bodyParser: false, logger: ["error"] });
plain.getHttpAdapter().getInstance().all("/api/auth/{*splat}", toNodeHandler(auth));
await plain.listen(3905, "127.0.0.1");
await show("fallback GET /api/auth/ok ->", await fetch("http://127.0.0.1:3905/api/auth/ok"));
await plain.close();
