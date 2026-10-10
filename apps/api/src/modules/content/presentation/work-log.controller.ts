import {
  type KnowledgeEntryDto,
  type KnowledgeEntryListDto,
  knowledgeEntryDto,
  knowledgeEntryListDto,
  knowledgeEntryParams,
} from "@jadero/contracts";
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  SerializeOptions,
  StandardSchemaSerializerInterceptor,
  UseInterceptors,
} from "@nestjs/common";
import type { z } from "zod";
import { ContentQueries } from "../application/content-queries.js";
import { PublicCacheInterceptor } from "./public-cache.interceptor.js";

/**
 * The public work log (ADR-031, D-52): approved knowledge entries, English only, so no locale
 * segment: `GET /v1/content/work` and `GET /v1/content/work/:entryId`. Same contract parsing and
 * cache headers as the localized reads; `Content-Language` is `en`.
 */
@Controller({ path: "content/work", version: "1" })
@UseInterceptors(PublicCacheInterceptor, StandardSchemaSerializerInterceptor)
export class WorkLogController {
  constructor(private readonly queries: ContentQueries) {}

  /** @returns every approved entry, by id. */
  @Get()
  @SerializeOptions({ schema: knowledgeEntryListDto })
  list(): Promise<KnowledgeEntryListDto> {
    return this.queries.workLog();
  }

  /**
   * @param params the entry id (`kb-...`); anything else is a 400.
   * @returns the approved revision of the entry.
   * @throws {NotFoundException} when the entry is not approved, withdrawn or deleted.
   */
  @Get(":entryId")
  @SerializeOptions({ schema: knowledgeEntryDto })
  async entry(
    @Param({ schema: knowledgeEntryParams }) params: z.output<typeof knowledgeEntryParams>,
  ): Promise<KnowledgeEntryDto> {
    const entry = await this.queries.workEntry(params.entryId);
    if (!entry) throw new NotFoundException(`No approved entry '${params.entryId}'.`);
    return entry;
  }
}
