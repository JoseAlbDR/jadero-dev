import { uuidv7 } from "@jadero/messaging";
import { Injectable } from "@nestjs/common";
import { IdGenerator } from "../application/id-generator.js";

/**
 * Production ids: UUIDv7, the same generator as WP-5's event ids. The first 48 bits are the time
 * in milliseconds and the rest is random, so new rows land at the end of the primary key index
 * instead of at random pages (WP-10 implementation choice "Ids"). Ids created in the same
 * millisecond are not ordered among themselves.
 */
@Injectable()
export class RandomIdGenerator extends IdGenerator {
  /**
   * @returns a new UUIDv7 for the current time.
   */
  next(): string {
    return uuidv7();
  }
}
