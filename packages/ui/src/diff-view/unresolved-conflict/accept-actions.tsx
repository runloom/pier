import type { ReactElement } from "react";
import type {
  ConflictResolution,
  PierUnresolvedConflictLabels,
} from "./types.ts";

export function ConflictAcceptActions(options: {
  readonly disabled: boolean;
  readonly labels: Pick<
    PierUnresolvedConflictLabels,
    "acceptBoth" | "acceptCurrent" | "acceptIncoming"
  >;
  readonly onAccept: (resolution: ConflictResolution) => void;
}): ReactElement {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs"
      data-pier-conflict-actions=""
    >
      <button
        className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={options.disabled}
        onClick={() => options.onAccept("current")}
        type="button"
      >
        {options.labels.acceptCurrent}
      </button>
      <span aria-hidden className="text-muted-foreground/60">
        |
      </span>
      <button
        className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={options.disabled}
        onClick={() => options.onAccept("incoming")}
        type="button"
      >
        {options.labels.acceptIncoming}
      </button>
      <span aria-hidden className="text-muted-foreground/60">
        |
      </span>
      <button
        className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={options.disabled}
        onClick={() => options.onAccept("both")}
        type="button"
      >
        {options.labels.acceptBoth}
      </button>
    </div>
  );
}
