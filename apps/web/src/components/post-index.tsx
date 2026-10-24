import type { PostKind, PostPageDto } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import { ArrowRight } from "lucide-react";
import type { Locale } from "next-intl";
import { POST_ROUTES } from "@/content/posts";
import { getPathname } from "@/i18n/navigation";
import { PostList } from "./post-list";

/** The localized texts of a post list page (the blog's or the journal's message namespace). */
export type PostIndexLabels = Readonly<{
  eyebrow: string;
  title: string;
  lead: string;
  empty: string;
  pagination: string;
  older: string;
}>;

type PostIndexProps = Readonly<{
  locale: Locale;
  /** The kind the page lists: its route builds the link to the next page. */
  kind: PostKind;
  page: PostPageDto;
  /** True on the first page (no `?cursor=`). */
  firstPage: boolean;
  labels: PostIndexLabels;
}>;

/**
 * The body of a post list page, shared by the blog (`/blog`) and the journal (`/journal`): the
 * header card, the post tiles (or the empty note) and the link to the next page. The next page is
 * a plain link with the API's `nextCursor` in `?cursor=`, followed as a document navigation so its
 * head is rendered fresh; the API gives no cursor back, so there is no "newer" link.
 * @param props.locale the page locale.
 * @param props.kind the kind of post listed.
 * @param props.page the page of posts from the API.
 * @param props.firstPage whether this is the first page of the list.
 * @param props.labels the page's localized texts.
 */
export function PostIndex({ locale, kind, page, firstPage, labels }: PostIndexProps) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Card asChild className="md:p-10">
        <header>
          <p className="font-mono text-signal text-xs uppercase tracking-widest">
            {labels.eyebrow}
          </p>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl">
            {labels.title}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">{labels.lead}</p>
        </header>
      </Card>
      {page.items.length === 0 ? (
        <Card className="mt-8">
          <p className="text-muted-foreground">{labels.empty}</p>
        </Card>
      ) : (
        <PostList items={page.items} locale={locale} firstPage={firstPage} />
      )}
      {page.nextCursor !== null && (
        <nav aria-label={labels.pagination} className="mt-8 flex justify-end">
          {/*
           * A plain <a>, not the router's Link: a document navigation renders the later page's head
           * on the server. With a client navigation, Next 16.3 can reuse the head it prefetched for
           * the nav's Blog link or the footer's Journal link (same route, no cursor), so the page
           * kept the first page's canonical and hreflang links and lost its `noindex`
           * (e2e/blog.spec.ts, e2e/journal.spec.ts).
           */}
          <a
            href={getPathname({
              href: { pathname: POST_ROUTES[kind].list, query: { cursor: page.nextCursor } },
              locale,
            })}
            className="glass inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm outline-none transition-colors hover:text-signal focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {labels.older}
            <ArrowRight aria-hidden className="size-4" />
          </a>
        </nav>
      )}
    </main>
  );
}
