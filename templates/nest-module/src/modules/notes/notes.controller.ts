import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import type { Note } from "./note.js";
import { NotesService } from "./notes.service.js";

// In a service, request schemas live in packages/contracts (ADR-006); here they stay local.
const AddNoteBody = z.object({ text: z.string().min(1).max(500) });

/** HTTP edge of the layered module: validates with the schema, delegates to the service. */
@Controller("notes")
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** `POST /notes` with `{ "text": "..." }`; a bad body becomes a 400 problem (global pipe). */
  @Post()
  add(@Body({ schema: AddNoteBody }) body: z.infer<typeof AddNoteBody>): Promise<Note> {
    return this.notes.add(body.text);
  }

  /** `GET /notes`. */
  @Get()
  list(): Promise<Note[]> {
    return this.notes.list();
  }
}
