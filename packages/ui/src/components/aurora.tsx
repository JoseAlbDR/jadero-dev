import { cn } from "../lib/cn";

/**
 * The soft aurora behind the page (ADR-045): decorative, hidden from assistive technology, never
 * catches the pointer. It is static, so reduced motion needs nothing from it. The `data-aurora`
 * attribute lets accessibility checks hide it, so contrast is measured on the solid surface.
 * @param props.className position and size classes from the caller; it fills its parent by default.
 */
export function Aurora({ className }: Readonly<{ className?: string }>) {
  return (
    <div
      aria-hidden
      data-aurora=""
      className={cn("aurora pointer-events-none absolute inset-0 -z-10", className)}
    />
  );
}
