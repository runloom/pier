import { formatDurationShort } from "@pier/ui/format.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentRuntimeIndexEntry,
  isAgentIndexNeedsYou,
  isAgentIndexRunning,
  sortAgentIndexEntries,
} from "@shared/contracts/agent-runtime-index.ts";
import i18next from "i18next";
import { Bot } from "lucide-react";
import { agentStatusTextKey } from "@/components/agent-status/agent-status-visual.ts";
import type {
  QuickPickItem,
  QuickPickSection,
} from "@/lib/command-palette/types.ts";

export const AGENT_INDEX_NEW_ID = "agents:new";

export interface BuildAgentIndexQuickPickOptions {
  emptyAction?: "new-agent" | undefined;
  limit?: number | undefined;
  now?: number | undefined;
  /** 当前锚点工作区，同窗内略优先 */
  preferredProjectRootPath?: string | undefined;
  /** 当前窗 electron windowId，用于「本窗口」标注与同序加权 */
  preferredWindowId?: string | undefined;
}

export interface AgentIndexQuickPickModel {
  entryByItemId: Map<string, AgentRuntimeIndexEntry>;
  items?: QuickPickItem[];
  sections?: QuickPickSection[];
}

function agentLabel(entry: AgentRuntimeIndexEntry): string {
  return getAgentCatalogEntry(entry.agentId)?.label ?? entry.agentId;
}

/**
 * 搜索/分组用状态文案（行 UI 走 AgentStatusLabel，不渲染此 badge）：
 * - 有 hook 五态 → 与终端状态栏同一 `terminal.agentStatus.*`
 * - 无 status（launch）→ 规格 §4.3「运行中」
 */
function statusSearchLabel(entry: AgentRuntimeIndexEntry): string {
  if (entry.status === undefined) {
    return i18next.t("agents.section.running");
  }
  return i18next.t(agentStatusTextKey(entry.status));
}

function statusDurationLabel(
  entry: AgentRuntimeIndexEntry,
  now: number
): string | undefined {
  // 无可信状态时不计时（对齐状态栏 launch icon-only；禁止用 updatedAt 冒充时长）
  if (entry.status === undefined || entry.stateStartedAt === undefined) {
    return statusSearchLabel(entry);
  }
  const elapsed = Math.max(0, now - entry.stateStartedAt);
  const locale = i18next.language?.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
  return formatDurationShort(elapsed, locale);
}

function windowDetail(
  entry: AgentRuntimeIndexEntry,
  options: {
    preferredWindowId: string | undefined;
    showWindowLabels: boolean;
  }
): string {
  const pathHint = entry.projectRootPath ?? entry.cwd;
  if (!options.showWindowLabels) {
    return pathHint ?? "";
  }
  const windowHint =
    options.preferredWindowId && entry.windowId === options.preferredWindowId
      ? i18next.t("agents.quickPick.thisWindow")
      : i18next.t("agents.quickPick.windowLabel", { id: entry.windowId });
  if (pathHint) {
    return `${windowHint} · ${pathHint}`;
  }
  return windowHint;
}

function toItem(
  entry: AgentRuntimeIndexEntry,
  options: {
    now: number;
    preferredWindowId?: string;
    showWindowLabels: boolean;
  }
): QuickPickItem {
  const statusLabel = statusSearchLabel(entry);
  const label = agentLabel(entry);
  const detail = windowDetail(entry, {
    preferredWindowId: options.preferredWindowId,
    showWindowLabels: options.showWindowLabels,
  });
  const description = statusDurationLabel(entry, options.now);
  return {
    data: entry,
    ...(description === undefined ? {} : { description }),
    ...(detail === "" ? {} : { detail }),
    icon: Bot,
    id: entry.agentRef,
    label,
    searchTerms: [
      label,
      entry.agentId,
      entry.panelId,
      entry.windowId,
      statusLabel,
      entry.projectRootPath,
      entry.cwd,
      description,
      detail === "" ? undefined : detail,
    ].filter((value): value is string => typeof value === "string"),
    ...(isAgentIndexNeedsYou(entry.status)
      ? { variant: "destructive" as const }
      : {}),
  };
}

function partition(entries: readonly AgentRuntimeIndexEntry[]): {
  needsYou: AgentRuntimeIndexEntry[];
  ready: AgentRuntimeIndexEntry[];
  running: AgentRuntimeIndexEntry[];
} {
  const needsYou: AgentRuntimeIndexEntry[] = [];
  const running: AgentRuntimeIndexEntry[] = [];
  const ready: AgentRuntimeIndexEntry[] = [];
  for (const entry of entries) {
    if (isAgentIndexNeedsYou(entry.status)) {
      needsYou.push(entry);
    } else if (isAgentIndexRunning(entry.status)) {
      running.push(entry);
    } else {
      ready.push(entry);
    }
  }
  return { needsYou, ready, running };
}

/**
 * Index 发现列表唯一 builder（命令面板全量 + 标题栏 limit:8 共用）。
 * L4「跳到下一个」只走快捷键 `pier.agents.focusWaiting`，不在列表内嵌重复行
 * （对齐 VS Code F8 / Slack 下一未读：零选择是快捷键，不是列表假条目）。
 */
export function buildAgentIndexQuickPick(
  entries: readonly AgentRuntimeIndexEntry[],
  options: BuildAgentIndexQuickPickOptions = {}
): AgentIndexQuickPickModel {
  const now = options.now ?? Date.now();
  const sorted = sortAgentIndexEntries(entries, {
    ...(options.preferredWindowId
      ? { preferredWindowId: options.preferredWindowId }
      : {}),
    ...(options.preferredProjectRootPath
      ? { preferredProjectRootPath: options.preferredProjectRootPath }
      : {}),
  });
  const limited =
    options.limit === undefined ? sorted : sorted.slice(0, options.limit);
  const entryByItemId = new Map(
    limited.map((entry) => [entry.agentRef, entry] as const)
  );

  if (limited.length === 0) {
    const emptyId =
      options.emptyAction === "new-agent" ? AGENT_INDEX_NEW_ID : "agents:empty";
    return {
      entryByItemId,
      items: [
        {
          description:
            options.emptyAction === "new-agent"
              ? i18next.t("agents.quickPick.emptyNewDetail")
              : i18next.t("agents.quickPick.emptyDetail"),
          disabled: options.emptyAction !== "new-agent",
          id: emptyId,
          label:
            options.emptyAction === "new-agent"
              ? i18next.t("agents.quickPick.emptyNew")
              : i18next.t("agents.quickPick.empty"),
        },
      ],
    };
  }

  const { needsYou, running, ready } = partition(limited);
  const distinctWindowIds = new Set(limited.map((entry) => entry.windowId));
  const itemOpts = {
    now,
    showWindowLabels: distinctWindowIds.size > 1,
    ...(options.preferredWindowId
      ? { preferredWindowId: options.preferredWindowId }
      : {}),
  };
  const sections: QuickPickSection[] = [];

  if (needsYou.length > 0) {
    sections.push({
      heading: i18next.t("agents.section.needsYou"),
      id: "needs-you",
      items: needsYou.map((entry) => toItem(entry, itemOpts)),
    });
  }
  if (running.length > 0) {
    sections.push({
      heading: i18next.t("agents.section.running"),
      id: "running",
      items: running.map((entry) => toItem(entry, itemOpts)),
    });
  }
  if (ready.length > 0) {
    sections.push({
      heading: i18next.t("agents.section.readyHint"),
      id: "ready",
      items: ready.map((entry) => toItem(entry, itemOpts)),
    });
  }

  return { entryByItemId, sections };
}
