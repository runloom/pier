import type { ReactElement } from "react";
import { Button } from "../../button.tsx";
import type { PierUnresolvedConflictLabels } from "./types.ts";

export function FileLevelConflictCard(options: {
  readonly busy: boolean;
  readonly labels: PierUnresolvedConflictLabels;
  readonly onOpenFile?: () => void;
  readonly onTakeOurs?: () => void | Promise<void>;
  readonly onTakeTheirs?: () => void | Promise<void>;
  readonly path: string;
}): ReactElement {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 p-4"
      data-pier-file-level-conflict=""
      data-pier-unresolved-path={options.path}
    >
      <div className="min-w-0">
        <div className="truncate font-mono text-muted-foreground text-xs">
          {options.path}
        </div>
        {options.busy ? (
          <span className="text-muted-foreground text-xs">
            {options.labels.resolving}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        {options.labels.description}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.onTakeOurs ? (
          <Button
            disabled={options.busy}
            onClick={() => {
              const result = options.onTakeOurs?.();
              if (result instanceof Promise) {
                result.catch(() => undefined);
              }
            }}
            type="button"
            variant="secondary"
          >
            {options.labels.keepOurs}
          </Button>
        ) : null}
        {options.onTakeTheirs ? (
          <Button
            disabled={options.busy}
            onClick={() => {
              const result = options.onTakeTheirs?.();
              if (result instanceof Promise) {
                result.catch(() => undefined);
              }
            }}
            type="button"
            variant="secondary"
          >
            {options.labels.keepTheirs}
          </Button>
        ) : null}
        {options.onOpenFile ? (
          <Button
            disabled={options.busy}
            onClick={options.onOpenFile}
            type="button"
            variant="outline"
          >
            {options.labels.openFile}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
