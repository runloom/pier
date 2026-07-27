import {
  formatBytes,
  formatPercent,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import {
  agentSessionTitleInput,
  resolveAgentSessionTitle,
} from "@shared/agent-session-title/index.ts";
import type {
  PierResourceSnapshot,
  SessionIdentity,
  SessionResourceRow,
} from "@shared/contracts/pier-resource.ts";
import i18next from "i18next";
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  workbenchKpiCollectionClassName,
  workbenchKpiCollectionStyle,
  workbenchKpiLayoutMode,
} from "@/lib/workbench/kpi-auto-layout.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import {
  acquirePierResourcePolling,
  pollPierResourceOnce,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  densityFor,
  processRowLimitFor,
  type ResourceDensity,
  type ResourceKpiId,
  visibleKpiIds,
} from "./system-resources-density.ts";

/**
 * KPI 单元格：主指标大、次指标小；纵排时数字完整可读。
 */
function KpiTile({
  label,
  role = "secondary",
  value,
}: {
  label: string;
  role?: "primary" | "secondary";
  value: string;
}) {
  const primary = role === "primary";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={cn(
          "truncate text-muted-foreground leading-none",
          primary ? "text-xs" : "text-[11px]"
        )}
      >
        {label}
      </span>
      <p
        className={cn(
          "min-w-0 break-all font-semibold tabular-nums leading-none tracking-tight",
          primary ? "text-2xl" : "text-lg"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function kpiLabel(id: ResourceKpiId, t: ReturnType<typeof useT>): string {
  switch (id) {
    case "totalMemory":
      return t("workbench.widget.systemResources.totalMemory");
    case "totalCpu":
      return t("workbench.widget.systemResources.totalCpu");
    case "appMemory":
      return t("workbench.widget.systemResources.appMemory");
    case "workloadMemory":
      return t("workbench.widget.systemResources.workloadMemory");
    default:
      return id;
  }
}

function kpiValue(
  id: ResourceKpiId,
  snapshot: PierResourceSnapshot,
  locale: string,
  t: ReturnType<typeof useT>
): string {
  const { summary } = snapshot;
  switch (id) {
    case "totalMemory":
      return formatBytes(summary.totalRelatedMemoryBytes, locale);
    case "totalCpu": {
      if (summary.totalRelatedCpuPercent === null) {
        return "—";
      }
      const value = formatPercent(summary.totalRelatedCpuPercent, locale);
      const cores = summary.hostLogicalCpuCount;
      if (cores !== undefined && cores > 0) {
        return t("workbench.widget.systemResources.totalCpuWithCores", {
          cores,
          value,
        });
      }
      return value;
    }
    case "appMemory":
      return formatBytes(summary.pierAppMemoryBytes, locale);
    case "workloadMemory":
      return formatBytes(summary.workloadMemoryBytes, locale);
    default:
      return "—";
  }
}

function sessionTitle(
  identity: SessionIdentity,
  t: ReturnType<typeof useT>
): string {
  switch (identity.kind) {
    case "agent":
      return resolveAgentSessionTitle(
        agentSessionTitleInput({
          agentId: identity.agentId,
          sessionTitle: identity.sessionTitle,
        })
      ).primary;
    case "task":
      return identity.label;
    case "shell":
      return (
        identity.commandLine ??
        t("workbench.widget.activityOverview.kind.shell")
      );
    case "idle":
      return t("workbench.widget.activityOverview.kind.idle");
    default:
      return t("workbench.widget.systemResources.sessionTerminal");
  }
}

function sessionHotDot(session: SessionResourceRow): string {
  if (session.hot) {
    return "bg-warning";
  }
  if (
    (session.cpuPercent ?? 0) > 0.05 ||
    (session.memoryBytes ?? 0) > 64 * 1024 * 1024
  ) {
    return "bg-success";
  }
  return "bg-muted-foreground/40";
}

/**
 * 工作台资源：KPI 汇总 + 终端会话列表（唯一列表）。
 * Pier 进程分项不在卡面展示；本体占用仍反映在 KPI。
 */
export function SystemResourcesWidget({
  refreshToken,
  size,
  visible,
}: WorkbenchWidgetComponentProps) {
  const t = useT();
  const locale = i18next.language || "en";
  const previousRefreshTokenRef = useRef(refreshToken);
  const workspaceApi = useWorkspaceStore((s) => s.api);

  useEffect(() => {
    if (!visible) {
      return;
    }
    return acquirePierResourcePolling();
  }, [visible]);

  useEffect(() => {
    if (previousRefreshTokenRef.current === refreshToken) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    if (visible) {
      pollPierResourceOnce();
    }
  }, [refreshToken, visible]);

  const snapshot = usePierResourceStore((s) => s.snapshot);
  const error = usePierResourceStore((s) => s.error);

  if (snapshot === null && error) {
    return (
      <WidgetError
        message={t("workbench.widget.systemResources.error")}
        onRetry={() => {
          pollPierResourceOnce().catch(() => undefined);
        }}
        retryLabel={t("workbench.widget.retry")}
      />
    );
  }
  if (snapshot === null) {
    return <WidgetSkeleton />;
  }

  const density: ResourceDensity = densityFor(size);
  const kpiIds = visibleKpiIds(density, size.w, size.h);
  const rowLimit = processRowLimitFor(density, size.h);
  const showDescription = density === "full";
  const showFooter = density !== "compact";
  // h≥3 有会话列表区（空态也占位，避免只剩 KPI 悬空）
  const showSessionList = density !== "compact";
  const allSessions = snapshot.sessions;
  const sessions = allSessions.slice(0, Math.max(rowLimit, 1));
  const sessionsTruncated = allSessions.length > sessions.length;
  const hostFree = snapshot.summary.hostMemoryFreeBytes;
  const observedAt =
    snapshot.sampledAt > 0
      ? formatRelativeTime(snapshot.sampledAt, Date.now(), locale)
      : "";

  const handleFocusSession = (panelId: string): void => {
    if (!workspaceApi) {
      return;
    }
    activateWorkspacePanel(workspaceApi, panelId, { reveal: "always" });
  };

  const kpiCount = kpiIds.length;
  const kpiGridClassName = workbenchKpiCollectionClassName(kpiCount);
  const kpiGridStyle = workbenchKpiCollectionStyle(kpiCount);
  const kpiLayout = workbenchKpiLayoutMode(kpiCount);

  return (
    <div
      className={
        density === "compact"
          ? "flex h-full min-h-0 flex-col justify-start gap-2 overflow-hidden p-2.5"
          : "flex h-full min-h-0 flex-col justify-start gap-3 overflow-hidden p-3"
      }
      data-density={density}
      data-kpi-layout={kpiLayout}
      data-testid="pier-resources-content"
    >
      {showDescription ? (
        <p
          className="shrink-0 text-muted-foreground text-xs leading-relaxed"
          data-testid="pier-resources-description"
        >
          {t("workbench.widget.systemResources.description")}
        </p>
      ) : null}

      <div
        className={kpiGridClassName}
        data-layout={kpiLayout}
        data-testid="pier-resources-kpis"
        style={kpiGridStyle}
      >
        {kpiIds.map((id, index) => (
          <KpiTile
            key={id}
            label={kpiLabel(id, t)}
            role={index === 0 ? "primary" : "secondary"}
            value={kpiValue(id, snapshot, locale, t)}
          />
        ))}
      </div>

      {showSessionList ? (
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
          data-testid="pier-resources-sessions"
        >
          <span className="shrink-0 text-muted-foreground text-xs">
            {sessionsTruncated
              ? t("workbench.widget.systemResources.sessionsShown", {
                  shown: sessions.length,
                  total: allSessions.length,
                })
              : t("workbench.widget.systemResources.sessionsHeading")}
          </span>
          {sessions.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center">
              <WidgetEmpty
                hint={t("workbench.widget.systemResources.sessionsEmptyHint")}
                title={t("workbench.widget.systemResources.sessionsEmpty")}
              />
            </div>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {sessions.map((session) => (
                <li key={`${session.windowId}:${session.panelId}`}>
                  <button
                    className="flex w-full items-center justify-between gap-2 rounded-md px-0.5 py-1.5 text-left text-xs transition-colors hover:bg-accent/50"
                    onClick={() => handleFocusSession(session.panelId)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          sessionHotDot(session)
                        )}
                      />
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {sessionTitle(session.identity, t)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground tabular-nums">
                      <span>
                        {session.memoryBytes === null
                          ? "—"
                          : formatBytes(session.memoryBytes, locale)}
                      </span>
                      <span className="w-10 text-right">
                        {session.cpuPercent === null
                          ? "—"
                          : formatPercent(session.cpuPercent, locale)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {showFooter ? (
        <div className="flex shrink-0 items-center justify-between gap-2 text-muted-foreground text-xs">
          <span className="truncate" data-testid="pier-resources-observed-at">
            {observedAt
              ? t("workbench.widget.systemResources.updatedAt", {
                  relative: observedAt,
                })
              : ""}
          </span>
          {hostFree !== undefined && density === "full" ? (
            <span
              className="shrink-0 tabular-nums"
              data-testid="pier-resources-host-free"
            >
              {t("workbench.widget.systemResources.hostFree", {
                value: formatBytes(hostFree, locale),
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
