import { MessageSquareText } from "lucide-react";
import { Link } from "@/i18n/navigation";

/** The `id` of the agent terminal card on the home: the "Ask about this" links scroll to it. */
export const ASK_ANCHOR_ID = "ask";

/** The query parameter that carries the CV bullet id to the home terminal (`/en?ask=<id>#ask`). */
export const ASK_QUERY_PARAM = "ask";

/**
 * Where an "Ask about this" link goes: the home, scrolled to the agent terminal, with the CV
 * bullet id in the query. Resting until the chat of WP-25 (owner's choice, WP-16): nothing is sent
 * anywhere, the link only carries the id. The home terminal reads `?ask=` and puts the question
 * about that bullet in its prompt for the visitor to send; the bullet id is the public contract
 * value (`cvBulletId`), so the URL holds nothing a visitor typed.
 * @param bulletId the id of the CV bullet, for example `backend-10`.
 * @returns a localized `Link` href: the home pathname, the query and the terminal anchor.
 */
export function askAboutHref(bulletId: string) {
  return { pathname: "/", query: { [ASK_QUERY_PARAM]: bulletId }, hash: ASK_ANCHOR_ID } as const;
}

type AskAboutLinkProps = Readonly<{
  bulletId: string;
  /** The `id` of the element holding the bullet text, so a screen reader hears which one. */
  describedBy: string;
  label: string;
}>;

/**
 * The "Ask about this" action of one CV bullet: a plain link to the home terminal, visible and
 * resting (no request, no client JavaScript). The visible label is the same on every bullet; the
 * bullet text is its description, so each link still says what it asks about.
 * @param props.bulletId the CV bullet id the link carries.
 * @param props.describedBy the `id` of the bullet text.
 * @param props.label the localized label.
 */
export function AskAboutLink({ bulletId, describedBy, label }: AskAboutLinkProps) {
  return (
    <Link
      href={askAboutHref(bulletId)}
      aria-describedby={describedBy}
      className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 font-mono text-signal text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <MessageSquareText aria-hidden className="size-3.5" />
      {label}
    </Link>
  );
}
