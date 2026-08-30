import { cn } from "@pier/ui/utils.ts";
import { CheckIcon } from "lucide-react";
import type { CommitRangeMarker, CommitRangeRole } from "./commit-range.ts";

function isRailRole(role: CommitRangeRole): boolean {
  return role === "end" || role === "middle" || role === "start";
}

function railConnectsTop(role: CommitRangeRole): boolean {
  return role === "end" || role === "middle";
}

function railConnectsBottom(role: CommitRangeRole): boolean {
  return role === "start" || role === "middle";
}

function RailStub({
  className,
  committed,
  preview,
}: {
  readonly className?: string;
  readonly committed: boolean;
  readonly preview: boolean;
}): React.JSX.Element {
  return (
    <span className={cn("relative min-h-0 w-full flex-1", className)}>
      {committed ? (
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary" />
      ) : null}
      {preview ? (
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground" />
      ) : null}
    </span>
  );
}

export function CommitRangeGutter({
  checked,
  committedRole,
  highlighted = false,
  hovered = false,
  marker,
  onHoverChange,
  onToggle,
  previewRole,
  testId,
}: {
  readonly checked: boolean;
  readonly committedRole: CommitRangeRole;
  readonly highlighted?: boolean;
  readonly hovered?: boolean;
  readonly marker: CommitRangeMarker;
  readonly onHoverChange: (hovered: boolean) => void;
  readonly onToggle: () => void;
  readonly previewRole: CommitRangeRole;
  readonly testId?: string;
}): React.JSX.Element {
  const rangeRole = previewRole ?? committedRole;
  const onPreviewRail = isRailRole(previewRole);
  const showHoverFill = (highlighted || hovered) && !checked;
  return (
    <span
      className="relative flex w-7 shrink-0 flex-col items-center self-stretch overflow-visible"
      data-rail-bottom={
        railConnectsBottom(committedRole) || railConnectsBottom(previewRole)
          ? "true"
          : "false"
      }
      data-rail-top={
        railConnectsTop(committedRole) || railConnectsTop(previewRole)
          ? "true"
          : "false"
      }
      data-range-marker={marker}
      data-range-tone={onPreviewRail ? "preview" : undefined}
      data-slot="commit-range-gutter"
    >
      <RailStub
        className="-mb-px"
        committed={railConnectsTop(committedRole)}
        preview={railConnectsTop(previewRole)}
      />
      <span className="relative z-10 shrink-0">
        {marker === "dot" ? (
          <span
            className={cn(
              "block size-1.5 rounded-full",
              onPreviewRail ? "bg-muted-foreground" : "bg-primary"
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none flex size-4 items-center justify-center rounded-[5px] border border-transparent bg-input/90",
              checked && "border-primary bg-primary text-primary-foreground",
              showHoverFill &&
                "border-muted-foreground bg-muted-foreground dark:bg-muted-foreground"
            )}
            data-slot="checkbox"
          >
            {checked ? <CheckIcon className="size-3.5" /> : null}
          </span>
        )}
      </span>
      <RailStub
        className="-mt-px"
        committed={railConnectsBottom(committedRole)}
        preview={railConnectsBottom(previewRole)}
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 right-0 -left-2 z-20 cursor-pointer"
        data-range-role={rangeRole ?? undefined}
        data-testid={testId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        onMouseEnter={() => {
          onHoverChange(true);
        }}
        onMouseLeave={() => {
          onHoverChange(false);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </span>
  );
}
