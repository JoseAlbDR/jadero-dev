import { describe, expect, it } from "vitest";
import { NotesRepository } from "./notes.repository.js";
import { NotesService } from "./notes.service.js";

describe("NotesService", () => {
  it("trims and stores a note, then lists it", async () => {
    const service = new NotesService(new NotesRepository());
    const note = await service.add("  buy milk  ");
    expect(note.text).toBe("buy milk");
    expect(await service.list()).toEqual([note]);
  });
});
