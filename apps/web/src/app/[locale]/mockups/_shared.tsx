import { cn } from "@jadero/ui/cn";
import { useTranslations } from "next-intl";

/** The proof pillars of report section 2A, as keys of `Mockups.pillars`. */
export const PILLARS = [
  "backend",
  "reliability",
  "testing",
  "cicd",
  "security",
  "delivery",
  "ai",
  "process",
] as const;

/** Suggested questions of the ask-me prompt, as keys of `Mockups.questions`. */
export const QUESTIONS = ["deploy", "outbox", "tests"] as const;

/** Product names are not translated, so they live here and not in the message files. */
export const STACK = [
  "NestJS",
  "Next.js",
  "PostgreSQL",
  "RabbitMQ",
  "LangGraph",
  "Docker",
  "nginx",
] as const;

/** Shell prompt and shortcut of the terminal mockup: commands are not translated either. */
export const TERMINAL = { cwd: "~/jadero.dev", command: "$ whoami", shortcut: "/" } as const;

/** Small label that marks every mockup as a placeholder, so a screenshot never passes as the site. */
export function MockupNotice() {
  const t = useTranslations("Mockups");
  return (
    <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
      {t("notice")}
    </p>
  );
}

/**
 * Direction 1's command-palette prompt: the input line with a blinking caret, the suggested
 * questions and the resting note. Shared by the terminal and hybrid mockups.
 * @param props.className layout classes from the page (margin, width).
 */
export function TerminalPrompt({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations("Mockups");
  return (
    <section
      aria-label={t("promptLabel")}
      className={cn("rounded-lg border bg-(--surface) shadow-2xl shadow-foreground/5", className)}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-5 text-left font-mono text-lg"
      >
        <span aria-hidden className="text-(--signal)">
          &gt;
        </span>
        <span className="text-muted-foreground">{t("promptLabel")}</span>
        <span aria-hidden className="mockup-caret -ml-2 h-6 w-2.5 bg-(--signal)" />
        <kbd className="ml-auto rounded border px-1.5 py-0.5 text-muted-foreground text-xs">
          {TERMINAL.shortcut}
        </kbd>
      </button>
      <div className="border-t px-5 py-4">
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          {t("promptHint")}
        </p>
        <ul className="mt-3 space-y-2 font-mono text-sm">
          {QUESTIONS.map((question) => (
            <li key={question}>
              <button type="button" className="text-left hover:text-(--signal)">
                <span aria-hidden className="text-muted-foreground">
                  ↳{" "}
                </span>
                {t(`questions.${question}`)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="flex items-center gap-2 border-t px-5 py-3 font-mono text-muted-foreground text-xs">
        <span aria-hidden className="size-2 rounded-full bg-(--signal)" />
        {t("resting")}
      </p>
    </section>
  );
}
