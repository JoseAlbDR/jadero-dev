import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { IdGenerator } from "../application/id-generator.js";

/** Production ids: random UUIDs. */
@Injectable()
export class RandomIdGenerator extends IdGenerator {
  next(): string {
    return randomUUID();
  }
}
