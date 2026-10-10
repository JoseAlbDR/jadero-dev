import { cn } from "@jadero/ui/cn";

type StackTagsProps = Readonly<{
  tags: string[];
  /** The localized name of the list for screen readers ("Stack"). */
  label: string;
  className?: string;
}>;

/**
 * The stack of a project as small mono chips. Renders nothing for an empty list.
 * @param props.tags the display tags in API order.
 * @param props.label the accessible name of the list.
 * @param props.className layout classes from the parent.
 */
export function StackTags({ tags, label, className }: StackTagsProps) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-md border border-border px-2 py-0.5 font-mono text-muted-foreground text-xs"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}
