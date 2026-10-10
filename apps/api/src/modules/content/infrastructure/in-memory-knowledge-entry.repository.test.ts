import { knowledgeEntryRepositoryContract } from "../application/knowledge-entry.repository.contract.js";
import { InMemoryKnowledgeEntryRepository } from "./in-memory-knowledge-entry.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
knowledgeEntryRepositoryContract("in-memory", () => new InMemoryKnowledgeEntryRepository());
