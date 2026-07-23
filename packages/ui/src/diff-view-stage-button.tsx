import { Minus, Plus, Undo2 } from "lucide-react";
import { Button } from "./button.tsx";
import type { PierDiffViewLabels } from "./diff-view-collapse.tsx";
import type { PierDiffViewStageControl } from "./diff-view-items.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

/**
 * Far-right multi-diff header actions.
 *
 * - unstaged: Restore (Undo2) + Stage (Plus)
 * - staged: Unstage (Minus) — not Undo2, so it never collides with Restore
 *
 * Uses Button size="icon-xs" (24 hit / 16 glyph) — same chrome density as collapse.
 */
export function DiffHeaderActions({
  canDiscard,
  labels,
  onDiscard,
  onToggleStage,
  stageControl,
}: {
  readonly canDiscard: boolean;
  readonly labels: PierDiffViewLabels;
  readonly onDiscard?: () => void;
  readonly onToggleStage: () => void;
  readonly stageControl: PierDiffViewStageControl;
}): React.JSX.Element {
  const staged = stageControl.state === "staged";
  const busy = stageControl.busy === true;

  if (staged) {
    return (
      <HeaderIconButton
        busy={busy}
        label={labels.unstageChanges}
        onClick={onToggleStage}
        testId="pier-diff-unstage-button"
      >
        <Minus data-icon="inline-start" />
      </HeaderIconButton>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-0.5"
      data-slot="pier-diff-header-action-group"
    >
      {canDiscard && onDiscard ? (
        <HeaderIconButton
          busy={busy}
          label={labels.discardChanges}
          onClick={onDiscard}
          testId="pier-diff-discard-button"
        >
          <Undo2 data-icon="inline-start" />
        </HeaderIconButton>
      ) : null}
      <HeaderIconButton
        busy={busy}
        label={labels.stageChanges}
        onClick={onToggleStage}
        testId="pier-diff-stage-button"
      >
        <Plus data-icon="inline-start" />
      </HeaderIconButton>
    </span>
  );
}

function HeaderIconButton({
  busy,
  children,
  label,
  onClick,
  testId,
}: {
  readonly busy: boolean;
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <Tooltip>
      {/*
        span carries the trigger ref. Button is not forwardRef, so Radix cannot
        anchor the tooltip if asChild is placed directly on Button.
      */}
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            aria-label={label}
            data-testid={testId}
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (busy) {
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
      <TooltipContent align="center" side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
