import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Note } from "./note.js";

/**
 * Storage for notes. In a real layered module this is the Drizzle repository (WP-10); the
 * in-memory map keeps the template runnable. A layered module needs no port: there is one
 * implementation and no rule to protect from it.
 */
@Injectable()
export class NotesRepository {
  private readonly notes = new Map<string, Note>();

  /** Stores a new note and returns it with its id. */
  async add(text: string): Promise<Note> {
    const note = { id: randomUUID(), text };
    this.notes.set(note.id, note);
    return note;
  }

  /** All notes, in insertion order. */
  async list(): Promise<Note[]> {
    return [...this.notes.values()];
  }
}
