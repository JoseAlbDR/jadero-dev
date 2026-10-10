import {
  type ExperienceListDto,
  experienceListDto,
  localeParams,
  localizedSlugParams,
  type PostDto,
  type PostPageDto,
  type ProfileDto,
  type ProjectDto,
  type ProjectListDto,
  postDto,
  postListQuery,
  postPageDto,
  profileDto,
  projectDto,
  projectListDto,
  projectListQuery,
  type SkillListDto,
  skillListDto,
} from "@jadero/contracts";
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  SerializeOptions,
  StandardSchemaSerializerInterceptor,
  UseInterceptors,
} from "@nestjs/common";
import type { z } from "zod";
import { ContentQueries } from "../application/content-queries.js";
import { PublicCacheInterceptor } from "./public-cache.interceptor.js";

/**
 * The public reads of the localized content (WP-12 step 7; URI version 1, amendment 2026-10-09):
 * `GET /v1/content/:locale/...`. The locale is in the path, never negotiated (one URL per
 * representation, no `Vary`); an unknown locale, slug, kind or cursor is a 400 from the parameter
 * schema before any query. Each response passes its contract schema (unknown keys are dropped),
 * then gets the public cache headers; a missing item is a 404 problem with no cache header.
 */
@Controller({ path: "content/:locale", version: "1" })
@UseInterceptors(PublicCacheInterceptor, StandardSchemaSerializerInterceptor)
export class LocalizedContentController {
  constructor(private readonly queries: ContentQueries) {}

  /**
   * `GET /v1/content/:locale/profile`.
   * @param params the locale.
   * @returns the published profile.
   * @throws {NotFoundException} when no profile is published.
   */
  @Get("profile")
  @SerializeOptions({ schema: profileDto })
  async profile(@Param({ schema: localeParams }) params: LocaleParams): Promise<ProfileDto> {
    const profile = await this.queries.profile(params.locale);
    if (!profile) throw new NotFoundException(`No published profile in ${params.locale}.`);
    return profile;
  }

  /**
   * `GET /v1/content/:locale/experience`.
   * @param params the locale.
   * @returns every published experience item with its CV bullets, in display order.
   */
  @Get("experience")
  @SerializeOptions({ schema: experienceListDto })
  experience(@Param({ schema: localeParams }) params: LocaleParams): Promise<ExperienceListDto> {
    return this.queries.experience(params.locale);
  }

  /**
   * `GET /v1/content/:locale/projects?kind=`.
   * @param params the locale.
   * @param query an optional project kind.
   * @returns the published projects in display order.
   */
  @Get("projects")
  @SerializeOptions({ schema: projectListDto })
  projects(
    @Param({ schema: localeParams }) params: LocaleParams,
    @Query({ schema: projectListQuery }) query: z.output<typeof projectListQuery>,
  ): Promise<ProjectListDto> {
    return this.queries.projects(params.locale, query.kind);
  }

  /**
   * `GET /v1/content/:locale/projects/:slug`, with the German fallback to the English slug.
   * @param params the locale and the localized slug.
   * @returns the published project.
   * @throws {NotFoundException} when no published project answers to the slug.
   */
  @Get("projects/:slug")
  @SerializeOptions({ schema: projectDto })
  async project(@Param({ schema: localizedSlugParams }) params: SlugParams): Promise<ProjectDto> {
    const project = await this.queries.project(params.locale, params.slug);
    if (!project) {
      throw new NotFoundException(`No published project '${params.slug}' in ${params.locale}.`);
    }
    return project;
  }

  /**
   * `GET /v1/content/:locale/posts?cursor=`: 20 posts per page, newest first.
   * @param params the locale.
   * @param query the opaque cursor of the previous page's `nextCursor`, decoded by its schema.
   * @returns one page and the next page's cursor.
   */
  @Get("posts")
  @SerializeOptions({ schema: postPageDto })
  posts(
    @Param({ schema: localeParams }) params: LocaleParams,
    @Query({ schema: postListQuery }) query: z.output<typeof postListQuery>,
  ): Promise<PostPageDto> {
    return this.queries.posts(params.locale, query.cursor);
  }

  /**
   * `GET /v1/content/:locale/posts/:slug`, with the German fallback to the English slug.
   * @param params the locale and the localized slug.
   * @returns the published post.
   * @throws {NotFoundException} when no published post answers to the slug.
   */
  @Get("posts/:slug")
  @SerializeOptions({ schema: postDto })
  async post(@Param({ schema: localizedSlugParams }) params: SlugParams): Promise<PostDto> {
    const post = await this.queries.post(params.locale, params.slug);
    if (!post) {
      throw new NotFoundException(`No published post '${params.slug}' in ${params.locale}.`);
    }
    return post;
  }

  /**
   * `GET /v1/content/:locale/skills`.
   * @param params the locale.
   * @returns every published skill in display order.
   */
  @Get("skills")
  @SerializeOptions({ schema: skillListDto })
  skills(@Param({ schema: localeParams }) params: LocaleParams): Promise<SkillListDto> {
    return this.queries.skills(params.locale);
  }
}

type LocaleParams = z.output<typeof localeParams>;
type SlugParams = z.output<typeof localizedSlugParams>;
