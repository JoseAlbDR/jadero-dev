import { experienceItemRepositoryContract } from "../application/experience-item.repository.contract.js";
import { InMemoryExperienceItemRepository } from "./in-memory-experience-item.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
experienceItemRepositoryContract("in-memory", () => new InMemoryExperienceItemRepository());
