import { postRepositoryContract } from "../application/post.repository.contract.js";
import { InMemoryPostRepository } from "./in-memory-post.repository.js";

// The Drizzle adapter runs the same suite on Postgres in `pnpm test:int`.
postRepositoryContract("in-memory", () => new InMemoryPostRepository());
