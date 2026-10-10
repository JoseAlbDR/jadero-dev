import type { SkillDto } from "@jadero/contracts";
import { cn } from "@jadero/ui/cn";
import { Card } from "@jadero/ui/components/card";
import type { Locale } from "next-intl";
import { groupSkills, WIDE_TILE_MIN_SKILLS } from "@/content/skills";
import { contentLang } from "./project-sections";

type SkillGroupsProps = Readonly<{ items: SkillDto[]; locale: Locale }>;

/**
 * The skills of the stack page as a bento grid of glass tiles (ADR-045), one tile per category in
 * the order the API first lists it; a category with many skills spans two columns. Each tile is a
 * section named by its category heading, with the skills as mono chips. A name the API returned in
 * another language (the German fallback) is marked with that `lang`.
 * @param props.items the published skills in API order.
 * @param props.locale the page locale.
 */
export function SkillGroups({ items, locale }: SkillGroupsProps) {
  const groups = groupSkills(items, locale);
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group, index) => {
        const headingId = `skills-${index}`;
        return (
          <li
            key={group.category}
            className={cn(group.skills.length >= WIDE_TILE_MIN_SKILLS && "sm:col-span-2")}
          >
            <Card asChild className="h-full">
              <section aria-labelledby={headingId}>
                <h2
                  id={headingId}
                  lang={group.lang}
                  className="font-mono text-signal text-xs uppercase tracking-widest"
                >
                  {group.category}
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {group.skills.map((skill) => (
                    <li
                      key={skill.name}
                      lang={contentLang(skill.locale, locale)}
                      className="rounded-md border border-border px-2.5 py-1 font-medium text-sm"
                    >
                      {skill.name}
                    </li>
                  ))}
                </ul>
              </section>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
