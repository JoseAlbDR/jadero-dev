import { projectRepositoryContract } from "../application/project.repository.contract.js";
import { InMemoryProjectRepository } from "./in-memory-project.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
projectRepositoryContract("in-memory", () => new InMemoryProjectRepository());
