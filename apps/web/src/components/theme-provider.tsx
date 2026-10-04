"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

const SCRIPT_TYPE = typeof window === "undefined" ? "text/javascript" : "application/json";

/**
 * Light, dark and system themes (ADR-023). next-themes puts the `dark` class on `<html>` from an
 * inline script before the first paint, so a reload never flashes the wrong theme.
 *
 * That script only has to run in the server HTML. When the locale changes, React mounts the layout
 * again on the client, creates the script there (where it never runs) and React 19 logs "Encountered
 * a script tag" in development. Typing the client copy as a data block (`application/json`) keeps
 * React quiet; `suppressHydrationWarning` on the script covers the `type` difference.
 * @param props next-themes provider props.
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={{ type: SCRIPT_TYPE }}
      {...props}
    />
  );
}
