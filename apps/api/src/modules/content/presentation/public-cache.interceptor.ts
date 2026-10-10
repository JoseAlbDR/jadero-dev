import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";

/**
 * The freshness of every public content read (D6): any cache may keep a copy for 60 seconds, so a
 * publish reaches it within about a minute; then serve it stale for 5 more minutes while it
 * revalidates in the background, or for a day while `api` is down.
 */
export const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";

/** The locale of a route without a locale segment: knowledge entries are English only. */
const DEFAULT_LANGUAGE = "en";

/**
 * The `Content-Language` of a public body: the `locale` of a single item, or every locale present
 * in a list's `items`, the requested one first (`de, en` when some German items fell back to
 * English). A body that names no locale (the English-only work log, an empty list) is in the
 * requested language.
 * @param body the response body, already parsed by its response schema.
 * @param requested the locale of the path, or `en` for routes without one.
 * @returns the header value.
 */
export function contentLanguage(body: unknown, requested: string): string {
  const localeOf = (value: unknown): string | undefined => {
    const locale = (value as { locale?: unknown } | null)?.locale;
    return typeof locale === "string" ? locale : undefined;
  };
  const single = localeOf(body);
  if (single !== undefined) return single;
  const items = (body as { items?: unknown } | null)?.items;
  const present = new Set(Array.isArray(items) ? items.map(localeOf) : []);
  present.delete(undefined);
  if (present.size === 0) return requested;
  const ordered = [...present].sort((a, b) => Number(b === requested) - Number(a === requested));
  return ordered.join(", ");
}

/**
 * Adds `Cache-Control` and `Content-Language` to a successful public read, after its response
 * schema has parsed the body (register it before `StandardSchemaSerializerInterceptor`, so it is
 * the outer one). Errors never pass through `map`, so a 400, 404 or 500 never carries a public
 * cache header. The `ETag` stays Express's weak body hash, and Express answers a matching
 * `If-None-Match` with 304, these headers included.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  /**
   * @param context the request context; only HTTP is handled.
   * @param next the rest of the chain.
   * @returns the body, unchanged.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ params?: Record<string, string | undefined> }>();
    const response = http.getResponse<{ setHeader(name: string, value: string): void }>();
    return next.handle().pipe(
      map((body: unknown) => {
        response.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
        response.setHeader(
          "Content-Language",
          contentLanguage(body, request.params?.locale ?? DEFAULT_LANGUAGE),
        );
        return body;
      }),
    );
  }
}
