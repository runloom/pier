/**
 * Codex-style per-hunk Stage / Unstage / Revert toolbar (Pierre annotations).
 *
 * Aligns with ChatGPT.app / Codex review UI:
 * - Anchor: last **change** line of the hunk (Codex `wa` / `W`) — see
 *   `hunkAnnotationAnchor` in diff-view-items.ts
 * - Geometry: `absolute -top-8.5 right-0.5` (Codex `Tn`) over the line-level
 *   annotation slot — not block bottom-right, not bottom-full / translate hacks
 * - Reveal: per-file hover (`visible` from PierDiffView), like `group/file-diff`
 * - Buttons: icon-xs + ghost；原生 title 避免碎片化大差异为每个按钮挂 Tooltip portal
 */
import { Minus, Plus, RotateCcw } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Button } from "../button.tsx";
import { Spinner } from "../spinner.tsx";
import { cn } from "../utils.ts";
import {
  type DiffViewInputStore,
  useDiffViewChangeControl,
} from "./input-store.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";

export interface PierHunkAnnotationMetadata {
  readonly canRevert?: boolean;
  /**
   * 0-based change island inside the @@ hunk (multiple green/red blocks per @@).
   * Stage/unstage extract only this island, not the whole @@.
   */
  readonly changeBlockIndex: number;
  readonly changeKey: string;
  readonly hunkIndex: number;
  readonly kind: "hunk-actions";
  readonly path: string;
  readonly stageState: "partial" | "staged" | "unstaged";
}

export type PierHunkAction = "stage" | "unstage" | "revert";

export interface PierHunkActionEvent {
  readonly action: PierHunkAction;
  readonly changeKey: string;
  readonly itemId: string;
  readonly path: string;
  readonly scope: "hunk";
}

export interface PierHunkActionLabels {
  readonly revertHunk: string;
  readonly stageHunk: string;
  readonly stageRemainingHunk?: string;
  readonly unstageHunk: string;
}

/** Codex Vx primary action for the current review section. */
export function primaryHunkActionForVariant(
  variant: "partial" | "staged" | "unstaged"
): "stage" | "unstage" {
  return variant === "staged" ? "unstage" : "stage";
}

/** Zed-style section capability: staged hunks can only be unstaged. */
export function canRevertHunkForVariant(
  variant: "partial" | "staged" | "unstaged"
): boolean {
  return variant !== "staged";
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
    typeof record.changeKey === "string" &&
    typeof record.path === "string" &&
    (record.canRevert === undefined || typeof record.canRevert === "boolean") &&
    (record.stageState === "partial" ||
      record.stageState === "staged" ||
      record.stageState === "unstaged")
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
  pendingAction,
  stageState = metadata.stageState,
}: {
  readonly disabled?: boolean;
  readonly fileItemId: string;
  readonly labels: PierHunkActionLabels;
  readonly metadata: PierHunkAnnotationMetadata;
  readonly onAction: (action: PierHunkAction) => void;
  readonly pendingAction?: PierHunkAction;
  readonly stageState?: "partial" | "staged" | "unstaged";
}): React.JSX.Element {
  const primaryAction = primaryHunkActionForVariant(stageState);
  let primaryLabel = labels.stageHunk;
  if (primaryAction === "unstage") {
    primaryLabel = labels.unstageHunk;
  } else if (stageState === "partial") {
    primaryLabel = labels.stageRemainingHunk ?? labels.stageHunk;
  }
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
        data-stage-state={stageState}
        data-testid="pier-hunk-actions"
      >
        {(metadata.canRevert ?? canRevertHunkForVariant(stageState)) ? (
          <HunkIconButton
            disabled={disabled}
            label={labels.revertHunk}
            onClick={() => {
              onAction("revert");
            }}
            pending={pendingAction === "revert"}
            testId="pier-hunk-revert"
          >
            <RotateCcw data-icon="inline-start" />
          </HunkIconButton>
        ) : null}
        <HunkIconButton
          disabled={disabled}
          label={primaryLabel}
          onClick={() => {
            onAction(primaryAction);
          }}
          pending={pendingAction === primaryAction}
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
  pending,
  testId,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <Button
      aria-busy={pending || undefined}
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
      title={label}
      tone="muted"
      type="button"
      variant="ghost"
    >
      {pending ? (
        <Spinner
          aria-hidden="true"
          className="size-3.5"
          data-icon="inline-start"
        />
      ) : (
        children
      )}
    </Button>
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
  readonly pendingAction?: PierHunkAction;
  readonly stageState?: "partial" | "staged" | "unstaged";
}): ReactNode {
  const {
    annotation,
    disabled,
    itemId,
    labels,
    onHunkAction,
    pendingAction,
    stageState,
  } = options;
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
          changeKey: metadata.changeKey,
          itemId,
          path: metadata.path,
          scope: "hunk",
        });
      }}
      {...(pendingAction === undefined ? {} : { pendingAction })}
      {...(stageState === undefined ? {} : { stageState })}
    />
  );
}

/**
 * Hunk annotation 的 React 包装（从 use-code-options.ts 抽离，控文件行数）。
 *
 * `memo` + `useDiffViewChangeControl` 把易变的控制态（busy / pendingAction /
 * canRevert）订阅下沉到单文件粒度，避免每次账本变更重渲染整个 CodeView。
 * annotation metadata 是正文解析时的锚点快照；按钮能力来自实时控制态，
 * changeKey 已移除账本时不渲染旧按钮，非 hunk annotation 不渲染。
 */
export const LiveHunkAnnotation = memo(function LiveHunkAnnotation({
  annotation,
  inputStore,
  itemId,
  labels,
  onHunkAction,
}: {
  readonly annotation: {
    readonly metadata?: PierDiffAnnotationMetadata;
  };
  readonly inputStore: DiffViewInputStore;
  readonly itemId: string;
  readonly labels: PierHunkActionLabels;
  readonly onHunkAction: (event: PierHunkActionEvent) => void;
}): ReactNode {
  const metadata = annotation.metadata;
  const changeKey = isPierHunkAnnotationMetadata(metadata)
    ? metadata.changeKey
    : "";
  const control = useDiffViewChangeControl(inputStore, itemId, changeKey);
  // annotation 是正文解析时的锚点快照；按钮能力必须来自实时控制态。
  // 当前账本已移除该 changeKey 时不继续渲染旧按钮；非 hunk annotation 不渲染。
  if (!(isPierHunkAnnotationMetadata(metadata) && control)) {
    return null;
  }
  const disabled = control.busy === true;
  // 可见性由 CSS [data-pier-file-host]:hover 控制，此处只渲染 DOM。
  return renderPierHunkAnnotation({
    annotation: {
      metadata: {
        ...metadata,
        canRevert: control.canRevert ?? canRevertHunkForVariant(control.state),
        stageState: control.state,
      },
    },
    ...(disabled ? { disabled: true } : {}),
    itemId,
    labels,
    onHunkAction,
    ...(control.pendingAction === undefined
      ? {}
      : { pendingAction: control.pendingAction }),
    stageState: control.state,
  });
});
