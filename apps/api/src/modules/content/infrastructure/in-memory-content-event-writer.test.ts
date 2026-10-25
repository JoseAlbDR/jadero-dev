import { contentEventWriterContract } from "../application/content-event-writer.contract.js";
import {
  InMemoryContentStore,
  InMemoryContentUnitOfWork,
} from "./in-memory-content.unit-of-work.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
contentEventWriterContract("in-memory", () => {
  const store = new InMemoryContentStore();
  return {
    unitOfWork: new InMemoryContentUnitOfWork(store),
    outbox: async () => [...store.events],
  };
});
