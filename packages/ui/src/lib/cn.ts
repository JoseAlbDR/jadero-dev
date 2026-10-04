import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, so a caller's `className` overrides a
 * component's default (`cn("px-4", "px-2")` is `"px-2"`). shadcn/ui components use it.
 * @param inputs class names, arrays or condition objects.
 * @returns the merged class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
