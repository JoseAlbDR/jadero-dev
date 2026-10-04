import { InMemoryMessageBus } from "../src/index.js";
import { messageBusContract } from "./support/message-bus-contract.js";

messageBusContract("in memory", async ({ retryTiersMs }) => {
  const bus = new InMemoryMessageBus({ retryTiersMs });
  return {
    bus,
    deadLetters: async (queue) => bus.deadLetters(queue),
    unrouted: async () => bus.unrouted(),
    close: async () => {
      await bus.stop();
      bus.dispose();
    },
  };
});
