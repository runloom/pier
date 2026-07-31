import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { formatDurationShort } from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type {
  TerminalAgentPanelMetadata,
  TerminalPanelSessionSnapshot,
} from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { RefreshCw } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { useState } from "react";

export function RestoredTaskResultView({
  className,
  fontFamily,
  fontSize,
  onContextMenu,
  task,
}: {
  className: string;
  fontFamily: string;
  fontSize: number;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  task: TaskPanelMetadata;
}) {
  const rows = [
    ["Task", task.label],
    ["Status", task.status],
    ["Command", task.rawCommand],
    ["CWD", task.cwd],
  ] as const;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: 恢复后的终端结果是原生右键菜单触发面，没有准确的交互 ARIA role
    <div
      className={cn(
        "overflow-auto bg-[var(--terminal-background,var(--background))] px-2 py-1.5 font-mono text-[var(--terminal-foreground,var(--foreground))] leading-[1.35]",
        className
      )}
      data-scrollbar="stable"
      data-testid="terminal-task-result"
      onContextMenu={onContextMenu}
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

function SummaryRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "font-mono text-xs leading-relaxed"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function agentSessionStatusPresentation(exitCode: number | undefined): {
  badgeVariant: "danger" | "success";
  label: string;
} {
  if (exitCode !== undefined && exitCode !== 0) {
    return {
      badgeVariant: "danger",
      label: i18next.t("terminal.agentSession.statusFailed"),
    };
  }
  return {
    badgeVariant: "success",
    label: i18next.t("terminal.agentSession.statusEnded"),
  };
}

export function RestoredAgentResultView({
  agent,
  className,
  onRestart,
}: {
  agent: TerminalAgentPanelMetadata;
  className: string;
  onRestart?: () => void | Promise<void>;
}) {
  const entry = getAgentCatalogEntry(agent.agentId);
  const agentLabel = entry?.label ?? agent.agentId;
  const command = agent.launch.command ?? agent.launch.agentId ?? agent.agentId;
  const [restarting, setRestarting] = useState(false);
  const status = agentSessionStatusPresentation(agent.exitCode);
  const locale = i18next.language || "en";
  const durationMs =
    agent.finishedAt === undefined
      ? undefined
      : Math.max(0, agent.finishedAt - agent.startedAt);

  return (
    <div
      className={cn(
        // 外壳只铺终端背景色，避免与产品 Empty/Card 前景 token 混用。
        "overflow-auto bg-[var(--terminal-background,var(--background))] text-foreground",
        className
      )}
      data-scrollbar="stable"
      data-testid="terminal-agent-result"
    >
      <Empty className="min-h-full rounded-none border-0 p-6" role="status">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AgentIcon agentId={agent.agentId} size={24} />
          </EmptyMedia>
          <EmptyTitle>
            {i18next.t("terminal.agentSession.endedTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {i18next.t("terminal.agentSession.endedBody")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="gap-5">
          {onRestart ? (
            <Button
              aria-busy={restarting || undefined}
              data-testid="terminal-agent-restart"
              disabled={restarting}
              onClick={() => {
                if (restarting) {
                  return;
                }
                setRestarting(true);
                Promise.resolve(onRestart()).finally(() => {
                  setRestarting(false);
                });
              }}
              size="sm"
              type="button"
            >
              <RefreshCw
                aria-hidden
                className={cn(restarting && "animate-spin")}
                data-icon="inline-start"
              />
              {i18next.t("terminal.agentSession.restart")}
            </Button>
          ) : null}
          <Card className="w-full max-w-sm text-left shadow-none" size="sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">
                {i18next.t("terminal.agentSession.summaryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-sm">
                <SummaryRow
                  label={i18next.t("terminal.agentSession.fieldAgent")}
                  value={agentLabel}
                />
                <SummaryRow
                  label={i18next.t("terminal.agentSession.fieldStatus")}
                  value={
                    <Badge
                      data-testid="terminal-agent-status-badge"
                      size="xs"
                      variant={status.badgeVariant}
                    >
                      {status.label}
                    </Badge>
                  }
                />
                {agent.launch.cwd ? (
                  <SummaryRow
                    label={i18next.t("terminal.agentSession.fieldCwd")}
                    mono
                    value={agent.launch.cwd}
                  />
                ) : null}
                <SummaryRow
                  label={i18next.t("terminal.agentSession.fieldCommand")}
                  mono
                  value={command}
                />
                {durationMs === undefined ? null : (
                  <SummaryRow
                    label={i18next.t("terminal.agentSession.fieldDuration")}
                    value={formatDurationShort(durationMs, locale)}
                  />
                )}
                {agent.exitCode === undefined ? null : (
                  <SummaryRow
                    label={i18next.t("terminal.agentSession.fieldExitCode")}
                    value={String(agent.exitCode)}
                  />
                )}
              </dl>
            </CardContent>
          </Card>
        </EmptyContent>
      </Empty>
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
