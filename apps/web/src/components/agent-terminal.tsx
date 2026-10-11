import { cn } from "@jadero/ui/cn";
import { type Locale, useTranslations } from "next-intl";
import type { AskBullet } from "@/content/ask";
import { ASK_ANCHOR_ID } from "./ask-about-link";
import { contentLang } from "./project-sections";

/** Window title of the terminal: an address, not translated. */
const WINDOW_TITLE = "ask@jadero.dev";

/** Suggested questions of the prompt, as keys of `AgentTerminal.questions`. */
const QUESTIONS = ["deploy", "outbox", "tests"] as const;

const TITLE_ID = "ask-title";
const RESTING_ID = "ask-resting";

type AgentTerminalProps = Readonly<{
  /** The CV bullet of `?ask=`, already resolved from the API, or `null` for the empty prompt. */
  bullet: AskBullet | null;
  locale: Locale;
  className?: string;
}>;

/**
 * The agent terminal of the home (ADR-045): a dark window in both themes (`--term-*` tokens) with
 * a glowing accent frame, the prompt line with a cyan caret, suggested questions and the resting
 * note. Resting until the chat of WP-25 (owner's choice, WP-16): the prompt line is text, the send
 * button is disabled and nothing is sent; this is a Server Component, so it ships no JavaScript
 * and makes no request from the browser. An "Ask about this" link lands here (`#ask`) with the
 * question about its CV bullet already in the prompt; the bullet text comes from the API, never
 * from the URL.
 * @param props.bullet the bullet to ask about, or `null`.
 * @param props.locale the page locale, to mark a bullet text in another language.
 * @param props.className layout classes from the page (grid placement).
 */
export function AgentTerminal({ bullet, locale, className }: AgentTerminalProps) {
  const t = useTranslations("AgentTerminal");

  return (
    <section
      id={ASK_ANCHOR_ID}
      aria-labelledby={TITLE_ID}
      className={cn("term-glow scroll-mt-6 rounded-card p-px", className)}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-[calc(var(--radius-card)-1px)] bg-term font-mono text-term-foreground">
        <div className="flex items-center gap-2 border-term-line border-b px-4 py-3">
          <span aria-hidden className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-term-line" />
            <span className="size-2.5 rounded-full bg-term-line" />
            <span className="size-2.5 rounded-full bg-term-line" />
          </span>
          <span className="mx-auto pr-10 text-term-muted text-xs">{WINDOW_TITLE}</span>
        </div>
        <div className="flex flex-1 flex-col gap-6 px-5 py-6">
          <h2 id={TITLE_ID} className="sr-only">
            {t("title")}
          </h2>
          <div className="rounded-xl border border-term-line bg-term-raised">
            <p className="flex gap-3 px-4 pt-4 pb-3 text-base leading-relaxed">
              <span aria-hidden className="text-term-signal">
                &gt;
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {bullet ? (
                  t.rich("question", {
                    bullet: () => (
                      <span lang={contentLang(bullet.locale, locale)}>{bullet.text}</span>
                    ),
                  })
                ) : (
                  <span className="text-term-muted">{t("placeholder")}</span>
                )}
                <span
                  aria-hidden
                  className="term-caret ml-1 inline-block h-5 w-2.5 translate-y-1 bg-term-signal"
                />
              </span>
            </p>
            <div className="flex justify-end border-term-line border-t px-3 py-2">
              <button
                type="button"
                disabled
                aria-describedby={RESTING_ID}
                className="cursor-not-allowed rounded-md border border-term-line px-3 py-1 text-term-muted text-xs"
              >
                {t("send")}
              </button>
            </div>
          </div>
          <div>
            <p className="text-term-muted text-xs uppercase tracking-widest">{t("hint")}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {QUESTIONS.map((question) => (
                <li key={question} className="flex gap-2">
                  <span aria-hidden className="text-term-signal">
                    →
                  </span>
                  {t(`questions.${question}`)}
                </li>
              ))}
            </ul>
          </div>
          <p id={RESTING_ID} className="mt-auto flex items-start gap-2 text-term-muted text-xs">
            <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-term-signal" />
            {t("resting")}
          </p>
        </div>
      </div>
    </section>
  );
}
