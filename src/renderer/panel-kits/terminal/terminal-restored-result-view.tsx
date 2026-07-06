import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type {
  TerminalAgentPanelMetadata,
  TerminalPanelSessionSnapshot,
} from "@shared/contracts/terminal.ts";

export function RestoredTaskResultView({
  className,
  fontFamily,
  fontSize,
  task,
}: {
  className: string;
  fontFamily: string;
  fontSize: number;
  task: TaskPanelMetadata;
}) {
  const rows = [
    ["Task", task.label],
    ["Status", task.status],
    ["Command", task.rawCommand],
    ["CWD", task.cwd],
  ] as const;

  return (
    <div
      className={`${className} overflow-auto bg-[var(--terminal-background,var(--background))] px-2 py-1.5 font-mono text-[var(--terminal-foreground,var(--foreground))] leading-[1.35]`}
      data-scrollbar="stable"
      data-testid="terminal-task-result"
      style={{ fontFamily, fontSize }}
    >
      <p className="mb-1 text-muted-foreground">[pier] restored task</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
        {task.exitCode === undefined ? null : (
          <div className="contents">
            <dt className="text-muted-foreground">Exit code</dt>
            <dd>{task.exitCode}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function RestoredAgentResultView({
  agent,
  className,
  fontFamily,
  fontSize,
}: {
  agent: TerminalAgentPanelMetadata;
  className: string;
  fontFamily: string;
  fontSize: number;
}) {
  const entry = getAgentCatalogEntry(agent.agentId);
  const rows: Array<readonly [string, string]> = [
    ["Agent", entry?.label ?? agent.agentId],
    ["Status", agent.status],
    ["Command", agent.launch.command ?? agent.launch.agentId ?? agent.agentId],
  ];
  if (agent.launch.cwd) {
    rows.push(["CWD", agent.launch.cwd]);
  }

  return (
    <div
      className={`${className} overflow-auto bg-[var(--terminal-background,var(--background))] px-2 py-1.5 font-mono text-[var(--terminal-foreground,var(--foreground))] leading-[1.35]`}
      data-scrollbar="stable"
      data-testid="terminal-agent-result"
      style={{ fontFamily, fontSize }}
    >
      <p className="mb-1 text-muted-foreground">[pier] restored agent</p>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
        {agent.exitCode === undefined ? null : (
          <div className="contents">
            <dt className="text-muted-foreground">Exit code</dt>
            <dd>{agent.exitCode}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function restoredTaskResultFromSession(
  session: TerminalPanelSessionSnapshot | null | undefined
): TaskPanelMetadata | undefined {
  const task = session?.task;
  if (!task || session?.taskLive) {
    return;
  }
  return task.status === "running" ? { ...task, status: "cancelled" } : task;
}

export function restoredAgentResultFromSession(
  session: TerminalPanelSessionSnapshot | null | undefined
): TerminalAgentPanelMetadata | undefined {
  const agent = session?.agent;
  return agent?.status === "exited" ? agent : undefined;
}
