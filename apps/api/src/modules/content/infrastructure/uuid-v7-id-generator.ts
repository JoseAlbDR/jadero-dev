import { uuidv7 } from "@jadero/messaging";
import { Injectable } from "@nestjs/common";
import { IdGenerator } from "../application/id-generator.js";

/**
 * Production ids: UUIDv7, the same generator as WP-5's event ids and the module template. The
 * first 48 bits are the time in milliseconds, so new rows land at the end of the primary key index
 * (WP-10 implementation choice "Ids"); ids from the same millisecond are not ordered among
 * themselves.
 */
@Injectable()
export class UuidV7IdGenerator extends IdGenerator {
  /**
   * @returns a new UUIDv7 for the current time.
   */
  next(): string {
    return uuidv7();
  }
}
