import { profileRepositoryContract } from "../application/profile.repository.contract.js";
import { InMemoryProfileRepository } from "./in-memory-profile.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
profileRepositoryContract("in-memory", () => new InMemoryProfileRepository());
