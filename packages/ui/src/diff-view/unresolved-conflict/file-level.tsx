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
      <ConflictChrome
        busy={options.busy}
        labels={options.labels}
        path={options.path}
        {...(options.onOpenFile === undefined
          ? {}
          : { onOpenFile: options.onOpenFile })}
      />
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

export function ConflictChrome(options: {
  readonly busy: boolean;
  readonly labels: PierUnresolvedConflictLabels;
  readonly onOpenFile?: () => void;
  readonly path: string;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm">
          {options.labels.title}
        </div>
        <div className="truncate font-mono text-muted-foreground text-xs">
          {options.path}
        </div>
      </div>
      {options.busy ? (
        <span className="text-muted-foreground text-xs">
          {options.labels.resolving}
        </span>
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
  );
}
