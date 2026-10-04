"use client";

import { cn } from "@jadero/ui/cn";
import { Button } from "@jadero/ui/components/button";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const THEMES = [
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
  { value: "system", Icon: Monitor },
] as const;

const subscribeNoop = () => () => {};

/** True only in the browser after hydration; the server cannot know the stored theme. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/** Three-way switch between the light, dark and system themes. */
export function ThemeToggle() {
  const t = useTranslations("ThemeToggle");
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  return (
    <fieldset className="flex items-center gap-0.5 rounded-md border p-0.5">
      <legend className="sr-only">{t("label")}</legend>
      {THEMES.map(({ value, Icon }) => {
        const active = hydrated && theme === value;
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="icon"
            className={cn("size-7", active && "bg-accent text-accent-foreground")}
            aria-pressed={active}
            aria-label={t(value)}
            title={t(value)}
            onClick={() => setTheme(value)}
          >
            <Icon aria-hidden />
          </Button>
        );
      })}
    </fieldset>
  );
}
