import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { ChevronDown } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import {
  TerminalRuntimeStatusIcon,
  terminalRuntimeStatusLabelKey,
} from "./terminal-runtime-status.tsx";

export function taskRunPanelNode(run: TaskRunControlEntry, panelId: string) {
  return (
    Object.values(run.nodes).find((node) => node.panelId === panelId) ??
    run.nodes[run.rootTaskId]
  );
}

export function TerminalRunSelector({
  disabled,
  label,
  onValueChange,
  panelId,
  runs,
  value,
}: {
  disabled: boolean;
  label: string;
  onValueChange(runId: string): void;
  panelId: string;
  runs: readonly TaskRunControlEntry[];
  value: string;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("terminal.runtimeControl.selectRunCurrent", { label })}
          className="min-w-0 flex-1 justify-start px-2"
          data-testid="terminal-runtime-control-run-selector"
          disabled={disabled}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span
            className="min-w-0 flex-1 truncate text-left font-medium text-xs"
            title={label}
          >
            {label}
          </span>
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72" sideOffset={6}>
        <DropdownMenuRadioGroup onValueChange={onValueChange} value={value}>
          {runs.map((candidate) => {
            const candidateNode = taskRunPanelNode(candidate, panelId);
            return (
              <DropdownMenuRadioItem
                key={candidate.runId}
                value={candidate.runId}
              >
                <TerminalRuntimeStatusIcon status={candidate.status} />
                <span className="min-w-0 flex-1 truncate">
                  {candidateNode?.label ?? candidate.rootTaskId}
                </span>
                <span className="sr-only">
                  {t(terminalRuntimeStatusLabelKey(candidate.status))}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
