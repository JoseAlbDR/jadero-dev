import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** Locale-aware wrappers of Next's navigation APIs; use these instead of `next/link`. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
