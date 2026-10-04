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

/** Small label that marks every mockup as a placeholder, so a screenshot never passes as the site. */
export function MockupNotice() {
  const t = useTranslations("Mockups");
  return (
    <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
      {t("notice")}
    </p>
  );
}
