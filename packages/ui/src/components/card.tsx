import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * Class names of the glass card (ADR-045). `tile` is a bento cell with a hover lift that only runs
 * when motion is allowed; `wide` holds long text (a case study, a post) in one card, with its
 * direct children kept to a readable measure.
 */
const cardVariants = cva("glass rounded-card p-6", {
  variants: {
    variant: {
      tile: "transition-transform duration-300 motion-safe:hover:-translate-y-1",
      wide: "w-full md:p-10 *:max-w-[70ch]",
    },
  },
  defaultVariants: {
    variant: "tile",
  },
});

type CardProps = ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & {
    /** Render the child element (a `section`, an `article`, a link) with the card's styles. */
    asChild?: boolean;
  };

/**
 * Glass card of the bento grid: a translucent surface over the aurora, a hairline border and the
 * large card radius.
 * @param props div props plus `variant` (`tile` or `wide`) and `asChild`.
 */
function Card({ className, variant, asChild = false, ...props }: CardProps) {
  const Comp = asChild ? Slot.Root : "div";
  return <Comp data-slot="card" className={cn(cardVariants({ variant, className }))} {...props} />;
}

export { Card, cardVariants };
