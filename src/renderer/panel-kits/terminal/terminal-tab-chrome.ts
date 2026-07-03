import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import {
  type AgentSessionSnapshot,
  agentTabIconId,
  tabStatusForAgentStatus,
} from "@shared/contracts/agent-session.ts";
import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelDescriptor,
  type PanelTabChrome,
} from "@shared/contracts/panel.ts";

/**
 * 路径 basename — POSIX 形式 (终端始终在 macOS).
 * 末尾 '/' 容错: "/" → "/"; "/a/b/" → "b"; "/a/b" → "b"; "" → "Terminal".
 */
export function basename(path: string): string {
  if (path === "" || path === "/") {
    return path === "" ? "Terminal" : "/";
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function tabChromeFromParams(
  params: unknown
): PanelTabChrome | undefined {
  if (!params || typeof params !== "object" || !("tab" in params)) {
    return;
  }
  return normalizePanelTabChromeInput(params.tab);
}

export function mergeTabChrome(
  current: PanelTabChrome | undefined,
  patch: Partial<PanelTabChrome> | null
): PanelTabChrome | undefined {
  if (!patch) {
    return current;
  }
  const normalizedPatch = normalizePanelTabChromeInput(patch);
  if (!normalizedPatch) {
    return current;
  }
  const next = {
    ...(current ?? {}),
    ...normalizedPatch,
    ...(normalizedPatch.badge
      ? { badge: { ...(current?.badge ?? {}), ...normalizedPatch.badge } }
      : {}),
    ...(normalizedPatch.icon
      ? { icon: { ...(current?.icon ?? {}), ...normalizedPatch.icon } }
      : {}),
    ...(normalizedPatch.state
      ? { state: { ...(current?.state ?? {}), ...normalizedPatch.state } }
      : {}),
    ...(normalizedPatch.tooltip
      ? {
          tooltip: {
            ...(current?.tooltip ?? {}),
            ...normalizedPatch.tooltip,
          },
        }
      : {}),
  };
  return normalizePanelTabChromeInput(next) ?? current;
}

export function terminalPanelDescriptor(args: {
  effectiveContext: PanelContext | undefined;
  effectiveCwd: string | null;
  effectiveTab: PanelTabChrome | undefined;
  effectiveTitle: string | null;
  sessionLoaded: boolean;
}): PanelDescriptor | null {
  if (!args.sessionLoaded) {
    return null;
  }
  const short =
    args.effectiveTab?.title ??
    (args.effectiveCwd ? basename(args.effectiveCwd) : "Terminal");
  return {
    ...(args.effectiveContext ? { context: args.effectiveContext } : {}),
    display: {
      short,
      ...(args.effectiveTitle || args.effectiveCwd
        ? { long: args.effectiveTitle ?? args.effectiveCwd ?? undefined }
        : {}),
      ...(args.effectiveTitle ? { terminalTitle: args.effectiveTitle } : {}),
    },
    ...(args.effectiveTab ? { tab: args.effectiveTab } : {}),
  };
}

/**
 * agent 会话的 tab 呈现 overlay：状态点 + icon + title 全部由 renderer store
 * 单源驱动（纯呈现层, 不进 tab-chrome-patch 持久化管线）——reload 后经
 * snapshot pull 自动恢复, 会话消失即自动回退, 无 main/renderer 生命周期
 * 不同步问题。agentId 来自 hook 事件或 native 命令行匹配（L1 shell integration）；
 * 无身份会话只带状态点不换 icon/title。
 */
export function agentTabChromeOverlay(
  session: AgentSessionSnapshot | undefined
): Partial<PanelTabChrome> | null {
  if (!session) {
    return null;
  }
  const status = { state: { status: tabStatusForAgentStatus(session.status) } };
  if (!session.agentId) {
    return status;
  }
  const entry = getAgentCatalogEntry(session.agentId);
  return {
    ...status,
    icon: { id: agentTabIconId(session.agentId) },
    title: entry?.label ?? session.agentId,
  };
}
