import { skillRepositoryContract } from "../application/skill.repository.contract.js";
import { InMemorySkillRepository } from "./in-memory-skill.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
skillRepositoryContract("in-memory", () => new InMemorySkillRepository());
