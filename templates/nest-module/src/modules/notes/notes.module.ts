import { Module } from "@nestjs/common";
import { NotesController } from "./notes.controller.js";
import { NotesRepository } from "./notes.repository.js";
import { NotesService } from "./notes.service.js";

/** Layered module (ADR-003): controller, application service, repository. */
@Module({ controllers: [NotesController], providers: [NotesService, NotesRepository] })
export class NotesModule {}
