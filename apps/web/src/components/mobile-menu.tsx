"use client";

import { Button } from "@jadero/ui/components/button";
import { Menu, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { usePathname } from "@/i18n/navigation";

const PANEL_ID = "mobile-menu";

/**
 * The header menu on phones (owner's choice, WP-16): a "Menu" button that shows and hides a glass
 * panel with the navigation, the locale switcher and the theme toggle (the disclosure pattern:
 * `aria-expanded` and `aria-controls` on a real button, the panel right after it in reading order).
 * The panel is part of the header's flow, so it pushes the page down instead of covering it.
 *
 * It closes on Escape (focus goes back to the button), on any link click inside it, and on every
 * navigation: the open state remembers the page it was opened on, so a new pathname or locale,
 * back and forward included, reads as closed without an effect. React attaches the handlers, so
 * there is no inline handler for the CSP to block.
 *
 * Renders as two flex children of the header bar: the button and, when open, the full-width panel.
 * @param props.children the panel content (the nav, the locale switcher, the theme toggle).
 * @param props.className classes of the button, for example `md:hidden`.
 * @param props.panelClassName classes of the panel, for example `md:hidden`.
 */
export function MobileMenu({
  children,
  className,
  panelClassName,
}: Readonly<{ children: ReactNode; className?: string; panelClassName?: string }>) {
  const t = useTranslations("Header");
  const here = `${useLocale()}${usePathname()}`;
  const [openOn, setOpenOn] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = openOn === here;

  const close = (refocus: boolean) => {
    setOpenOn(null);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onPanelClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a")) close(false);
  };

  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="sm"
        className={className}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpenOn(open ? null : here)}
        onKeyDown={onKeyDown}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
        {t("menu")}
      </Button>
      {open && (
        // The container only catches Escape and link clicks bubbling up from its links and
        // buttons; it is not itself interactive.
        // biome-ignore lint/a11y/noStaticElementInteractions: event delegation from the links inside
        <div id={PANEL_ID} className={panelClassName} onKeyDown={onKeyDown} onClick={onPanelClick}>
          {children}
        </div>
      )}
    </>
  );
}
