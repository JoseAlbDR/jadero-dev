import { describe, expect, it } from "vitest";
import { topicMatches } from "../src/index.js";

describe("topicMatches (RabbitMQ topic exchange rules)", () => {
  it.each([
    ["system.ping.v1", "system.ping.v1", true],
    ["system.ping.*", "system.ping.v1", true],
    ["system.ping.*", "system.ping.v1.extra", false],
    ["content.#", "content.published.v1", true],
    ["content.#", "content", true],
    ["#", "anything.at.all", true],
    ["content.published.*", "content.withdrawn.v1", false],
    ["*.ping.v1", "system.ping.v1", true],
    ["system.ping.v1", "system.ping.v2", false],
  ])("%s with %s is %s", (binding, key, expected) => {
    expect(topicMatches(binding, key)).toBe(expected);
  });
});
