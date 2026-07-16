import { shouldRotateCollapseChevron } from "./diff-view-presentation.ts";
import { cn } from "./utils.ts";

/** `@pierre/icons@0.7.1/IconChevronSm` 的冻结 SVG；包入口缺少 ESM 扩展名，无法直引。 */
function IconChevronSm({
  className,
  ...props
}: React.ComponentProps<"svg">): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={cn("pi", className)}
      fill="currentColor"
      height="16"
      viewBox="0 0 10 16"
      width="10"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M.47 5.47a.75.75 0 0 1 1.06 0L5 8.94l3.47-3.47a.75.75 0 0 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  );
}

export interface PierDiffViewLabels {
  readonly collapseDiff: string;
  readonly expandDiff: string;
}

const OFFICIAL_COLLAPSE_BUTTON_CLASS =
  "text-muted-foreground hover:bg-muted hover:text-foreground ml-[-8px] inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-50";

export function CollapseDiffButton({
  collapsed = false,
  disabled = false,
  labels,
  loading = false,
  onToggle,
}: {
  readonly collapsed?: boolean;
  readonly disabled?: boolean;
  readonly labels: PierDiffViewLabels;
  /** 懒加载占位：禁用折叠，但不得呈现为 collapsed。 */
  readonly loading?: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const inactive = disabled || loading;
  let ariaLabel: string | undefined;
  if (!inactive) {
    ariaLabel = collapsed ? labels.expandDiff : labels.collapseDiff;
  }
  const rotate = shouldRotateCollapseChevron({
    collapsed,
    disabled,
    loading,
  });
  return (
    <button
      aria-busy={loading || undefined}
      aria-expanded={inactive ? false : !collapsed}
      aria-hidden={inactive}
      aria-label={ariaLabel}
      className={OFFICIAL_COLLAPSE_BUTTON_CLASS}
      disabled={inactive}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      type="button"
    >
      <IconChevronSm
        aria-hidden="true"
        className={cn("size-4 transition-transform", rotate && "-rotate-90")}
      />
    </button>
  );
}
