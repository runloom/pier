/**
 * Codex-style per-hunk Stage / Unstage / Revert toolbar (Pierre annotations).
 *
 * Aligns with ChatGPT.app / Codex review UI:
 * - Anchor: last **change** line of the hunk (Codex `wa` / `W`) — see
 *   `hunkAnnotationAnchor` in diff-view-items.ts
 * - Geometry: `absolute -top-8.5 right-0.5` (Codex `Tn`) over the line-level
 *   annotation slot — not block bottom-right, not bottom-full / translate hacks
 * - Reveal: per-file hover (`visible` from PierDiffView), like `group/file-diff`
 * - Buttons: icon-xs + ghost + Tooltip (Pier file-header density)
 */
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";
import { cn } from "./utils.ts";

export interface PierHunkAnnotationMetadata {
  /**
   * 0-based change island inside the @@ hunk (multiple green/red blocks per @@).
   * Stage/unstage extract only this island, not the whole @@.
   */
  readonly changeBlockIndex: number;
  readonly hunkIndex: number;
  readonly kind: "hunk-actions";
  readonly path: string;
  /** Codex hunkActionsVariant: drives Stage vs Unstage primary action. */
  readonly variant: "staged" | "unstaged";
}

export type PierHunkAction = "stage" | "unstage" | "revert";

export interface PierHunkActionEvent {
  readonly action: PierHunkAction;
  readonly changeBlockIndex: number;
  readonly hunkIndex: number;
  readonly itemId: string;
  readonly path: string;
  readonly scope: "hunk";
  readonly variant: "staged" | "unstaged";
}

export interface PierHunkActionLabels {
  readonly revertHunk: string;
  readonly stageHunk: string;
  readonly unstageHunk: string;
}

/** Codex Vx primary action for the current review section. */
export function primaryHunkActionForVariant(
  variant: "staged" | "unstaged"
): "stage" | "unstage" {
  return variant === "staged" ? "unstage" : "stage";
}

export function isPierHunkAnnotationMetadata(
  value: unknown
): value is PierHunkAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "hunk-actions" &&
    typeof record.hunkIndex === "number" &&
    typeof record.changeBlockIndex === "number" &&
    typeof record.path === "string" &&
    (record.variant === "staged" || record.variant === "unstaged")
  );
}

/**
 * Codex `Tn`: Revert + Stage|Unstage floating pill over the annotation line.
 */
export function PierHunkActionToolbar({
  disabled = false,
  fileItemId,
  labels,
  metadata,
  onAction,
}: {
  readonly disabled?: boolean;
  readonly fileItemId: string;
  readonly labels: PierHunkActionLabels;
  readonly metadata: PierHunkAnnotationMetadata;
  readonly onAction: (action: PierHunkAction) => void;
}): React.JSX.Element {
  const primaryAction = primaryHunkActionForVariant(metadata.variant);
  const primaryLabel =
    primaryAction === "unstage" ? labels.unstageHunk : labels.stageHunk;
  const PrimaryIcon = primaryAction === "unstage" ? Minus : Plus;

  return (
    <div className="relative w-full" data-pier-hunk-anchor="">
      <div
        className={cn(
          // Codex Tn geometry (verbatim spacing tokens):
          // absolute -top-8.5 right-0.5 z-20 …
          // 默认隐藏 / hover 显示由 document 级 PIER_DIFF_LIGHT_DOM_CSS 控制
          //（annotation 是 light DOM portal，shadow unsafeCSS 够不到）。
          "absolute -top-8.5 right-0.5 z-30",
          "flex items-center gap-0.5 rounded-full",
          "bg-background/90 px-0.5 py-0.5 shadow-sm ring-1 ring-border/60"
        )}
        data-file-item-id={fileItemId}
        data-pier-hunk-actions=""
        data-testid="pier-hunk-actions"
        data-variant={metadata.variant}
      >
        <HunkIconButton
          disabled={disabled}
          label={labels.revertHunk}
          onClick={() => {
            onAction("revert");
          }}
          testId="pier-hunk-revert"
        >
          <RotateCcw data-icon="inline-start" />
        </HunkIconButton>
        <HunkIconButton
          disabled={disabled}
          label={primaryLabel}
          onClick={() => {
            onAction(primaryAction);
          }}
          testId={
            primaryAction === "unstage"
              ? "pier-hunk-unstage"
              : "pier-hunk-stage"
          }
        >
          <PrimaryIcon data-icon="inline-start" />
        </HunkIconButton>
      </div>
    </div>
  );
}

function HunkIconButton({
  children,
  disabled = false,
  label,
  onClick,
  testId,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            aria-label={label}
            data-testid={testId}
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (disabled) {
                return;
              }
              onClick();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            size="icon-xs"
            tone="muted"
            type="button"
            variant="ghost"
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent align="center" side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function renderPierHunkAnnotation(options: {
  readonly annotation: {
    readonly metadata?: unknown;
  };
  readonly disabled?: boolean;
  readonly itemId: string;
  readonly labels: PierHunkActionLabels;
  readonly onHunkAction?: (event: PierHunkActionEvent) => void;
}): ReactNode {
  const { annotation, disabled, itemId, labels, onHunkAction } = options;
  if (!(onHunkAction && isPierHunkAnnotationMetadata(annotation.metadata))) {
    return null;
  }
  const metadata = annotation.metadata;
  return (
    <PierHunkActionToolbar
      {...(disabled === undefined ? {} : { disabled })}
      fileItemId={itemId}
      labels={labels}
      metadata={metadata}
      onAction={(action) => {
        onHunkAction({
          action,
          changeBlockIndex: metadata.changeBlockIndex,
          hunkIndex: metadata.hunkIndex,
          itemId,
          path: metadata.path,
          scope: "hunk",
          variant: metadata.variant,
        });
      }}
    />
  );
}
