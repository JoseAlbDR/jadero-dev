import { NestFactory } from "@nestjs/core";
import { AppModule, hookLog, StandardSchemaValidationPipe } from "./app.js";

const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new StandardSchemaValidationPipe());
await app.listen(3901, "127.0.0.1");

const greet = await fetch("http://127.0.0.1:3901/greet").then((r) => r.text());
console.log("GET /greet ->", greet);
const bad = await fetch("http://127.0.0.1:3901/echo", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "not-an-email", locale: "fr" }),
});
console.log("POST /echo invalid ->", bad.status, bad.headers.get("content-type"), await bad.text());

await app.close();
console.log("hook order:", hookLog.join(" -> "));
