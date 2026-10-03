import { Injectable } from "@nestjs/common";
import { GreetingService } from "./app.js";

@Injectable()
export class Consumer {
  constructor(private readonly greeting: GreetingService) {}

  /** Uses the injected class only through its type position plus a call. */
  run(): string {
    return this.greeting.greet();
  }
}
