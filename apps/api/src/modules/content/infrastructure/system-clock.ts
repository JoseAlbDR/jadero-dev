import { Injectable } from "@nestjs/common";
import { Clock } from "../application/clock.js";

/** Production time: the system clock. */
@Injectable()
export class SystemClock extends Clock {
  /**
   * @returns the current system time.
   */
  now(): Date {
    return new Date();
  }
}
