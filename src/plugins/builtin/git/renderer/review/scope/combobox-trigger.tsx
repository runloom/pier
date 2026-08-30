import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ChevronDown } from "lucide-react";

const BRANCH_TRIGGER_MAX_CLASS = "max-w-56";

export function ComboboxTriggerButton({
  className,
  icon,
  label,
  placeholder,
  secondary = null,
  testId,
  trailing = null,
  ...triggerProps
}: {
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string | null;
  readonly placeholder: string;
  readonly secondary?: string | null;
  readonly testId: string;
  readonly trailing?: string | null;
} & Omit<
  React.ComponentProps<typeof Button>,
  "className" | "title"
>): React.JSX.Element {
  const empty = label === null;
  return (
    <Button
      className={cn(
        "min-w-0 justify-start gap-1",
        BRANCH_TRIGGER_MAX_CLASS,
        className
      )}
      data-testid={testId}
      size="xs"
      type="button"
      variant="ghost"
      {...triggerProps}
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className={cn("min-w-0 truncate", empty && "text-foreground/30")}
          data-slot="combobox-trigger-label"
        >
          {label ?? placeholder}
        </span>
        {secondary === null ? null : (
          <span
            className="min-w-0 truncate font-normal text-muted-foreground"
            data-slot="combobox-trigger-secondary"
          >
            {secondary}
          </span>
        )}
        {trailing === null ? null : (
          <span
            className="shrink-0 font-normal text-muted-foreground tabular-nums"
            data-slot="combobox-trigger-trailing"
          >
            {trailing}
          </span>
        )}
      </span>
      <ChevronDown data-icon="inline-end" />
    </Button>
  );
}
