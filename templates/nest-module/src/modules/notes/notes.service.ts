import { Injectable } from "@nestjs/common";
import type { Note } from "./note.js";
import { NotesRepository } from "./notes.repository.js";

/** The application service: the one place the controller calls; trims and stores. */
@Injectable()
export class NotesService {
  constructor(private readonly repository: NotesRepository) {}

  /** Adds a note with surrounding whitespace removed. */
  add(text: string): Promise<Note> {
    return this.repository.add(text.trim());
  }

  /** Lists every note. */
  list(): Promise<Note[]> {
    return this.repository.list();
  }
}
