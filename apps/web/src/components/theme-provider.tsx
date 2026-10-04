"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Light, dark and system themes (ADR-023). next-themes puts the `dark` class on `<html>` from an
 * inline script before the first paint, so a reload never flashes the wrong theme.
 * @param props next-themes provider props.
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  );
}
