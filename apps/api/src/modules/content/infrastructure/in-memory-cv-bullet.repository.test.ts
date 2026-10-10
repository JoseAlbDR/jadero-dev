import { cvBulletRepositoryContract } from "../application/cv-bullet.repository.contract.js";
import { InMemoryContentStore } from "./in-memory-content.unit-of-work.js";
import { InMemoryCvBulletRepository } from "./in-memory-cv-bullet.repository.js";
import { InMemoryExperienceItemRepository } from "./in-memory-experience-item.repository.js";
import { InMemoryProjectRepository } from "./in-memory-project.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
cvBulletRepositoryContract("in-memory", () => {
  const store = new InMemoryContentStore();
  return {
    cvBullets: new InMemoryCvBulletRepository(store.cvBullets, store),
    experienceItems: new InMemoryExperienceItemRepository(store.experienceItems),
    projects: new InMemoryProjectRepository(store.projects),
  };
});
