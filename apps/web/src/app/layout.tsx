import type { ReactNode } from "react";

/**
 * Root layout. The `<html>` element lives in `[locale]/layout.tsx`, which knows the locale;
 * this one only passes its children through.
 * @param props.children the locale layout.
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
