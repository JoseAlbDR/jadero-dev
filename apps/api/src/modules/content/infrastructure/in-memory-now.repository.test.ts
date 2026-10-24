import { nowRepositoryContract } from "../application/now.repository.contract.js";
import { InMemoryNowRepository } from "./in-memory-now.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
nowRepositoryContract("in-memory", () => new InMemoryNowRepository());
