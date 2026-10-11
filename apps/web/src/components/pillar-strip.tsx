import { Card } from "@jadero/ui/components/card";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Where a pillar is proven (report section 2A, "Proven on the site by"), as keys of
 * `HomePage.evidence`. `href` is the pathname of a page that exists today; evidence that lives in
 * a page of a later WP (Under the hood, the journal, the agent, the MCP server) or outside the site
 * has `null` and is shown as plain text, and gets its link when that page ships.
 */
const EVIDENCE = {
  caseStudies: "/projects",
  workLog: "/work",
  underTheHood: null,
  publicRepo: null,
  changelogs: null,
  thisSite: null,
  elRefugio: "/projects",
  agent: null,
  mcp: null,
  langChainAssistant: "/projects",
  frameworkCase: "/projects",
  journal: null,
} as const satisfies Record<string, "/projects" | "/work" | null>;

type Evidence = keyof typeof EVIDENCE;

/**
 * The eight proof pillars of report section 2A (D-73) in display order, each with its evidence
 * map. Fixed site copy (owner's choice, WP-16): titles and lines live in the message files, not
 * in the content API.
 */
const PILLARS = [
  { key: "backend", evidence: ["caseStudies", "workLog"] },
  { key: "reliability", evidence: ["workLog", "underTheHood"] },
  { key: "testing", evidence: ["workLog", "publicRepo"] },
  { key: "cicd", evidence: ["underTheHood", "changelogs"] },
  { key: "security", evidence: ["workLog"] },
  { key: "delivery", evidence: ["thisSite", "elRefugio"] },
  { key: "ai", evidence: ["agent", "mcp", "langChainAssistant"] },
  { key: "process", evidence: ["frameworkCase", "journal"] },
] as const satisfies readonly { key: string; evidence: readonly Evidence[] }[];

/**
 * The pillar strip of the home (D-74, ADR-045): one glass tile per proof pillar with its title, one
 * line and where it is proven, links for the pages that exist and plain text for the rest.
 */
export function PillarStrip() {
  const t = useTranslations("HomePage");

  return (
    <section aria-labelledby="pillars-title" className="min-w-0 md:col-span-4">
      <h2 id="pillars-title" className="mt-8 font-semibold text-2xl tracking-tight">
        {t("pillarsTitle")}
      </h2>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map(({ key, evidence }) => (
          <li key={key} className="flex min-w-0">
            <Card asChild className="flex w-full min-w-0 flex-col">
              <article aria-labelledby={`pillar-${key}`}>
                <h3
                  id={`pillar-${key}`}
                  className="text-pretty font-semibold hyphens-auto [overflow-wrap:anywhere]"
                >
                  {t(`pillars.${key}.title`)}
                </h3>
                <p className="mt-2 text-pretty text-muted-foreground text-sm hyphens-auto [overflow-wrap:anywhere]">
                  {t(`pillars.${key}.line`)}
                </p>
                <p className="mt-auto pt-4 font-mono text-muted-foreground text-xs uppercase tracking-widest">
                  {t("provenBy")}
                </p>
                <ul className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm">
                  {evidence.map((item) => (
                    <li key={item} className="min-w-0 max-w-full">
                      <EvidenceItem item={item} label={t(`evidence.${item}`)} />
                    </li>
                  ))}
                </ul>
              </article>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One piece of evidence: a link when its page exists, plain text otherwise.
 * @param props.item the evidence key.
 * @param props.label its localized name.
 */
function EvidenceItem({ item, label }: Readonly<{ item: Evidence; label: string }>) {
  const href = EVIDENCE[item];
  if (href === null) {
    return <span className="text-muted-foreground [overflow-wrap:anywhere]">{label}</span>;
  }
  return (
    <Link
      href={href}
      className="rounded-sm text-signal [overflow-wrap:anywhere] underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {label}
      <ArrowUpRight aria-hidden className="ml-0.5 inline size-3.5 shrink-0 align-[-0.125em]" />
    </Link>
  );
}
