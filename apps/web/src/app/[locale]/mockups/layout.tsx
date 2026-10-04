import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fontVariables } from "./fonts";
import "./mockups.css";

/** The mockups are throwaway: keep them out of search engines. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Wrapper of the WP-15 mockups: defines the candidate font variables for every direction.
 * @param props.children the mockup page.
 */
export default function MockupsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={fontVariables}>{children}</div>;
}
