import {
  agentSessionTitleInput,
  normalizeAgentSessionTitle,
  resolveAgentSessionTitle,
} from "@shared/agent-session-title/index.ts";
import i18next from "i18next";
import { showAppAlert, showAppPrompt } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { projectPathFromContext } from "@/stores/workspace-panel-helpers.ts";

/**
 * 用户改名 = 钉死 tab 覆盖（source=user），优先于 OSC，直到再次改名。
 * 入口：终端右键、面板 tab、命令面板、活动总览——共用本函数，初值/校验/失败一致。
 */
export function canRenameAgentSession(panelId: string): boolean {
  return (
    useForegroundActivityStore.getState().activities[panelId]?.kind === "agent"
  );
}

/**
 * 改名对话框初值：
 * 1. 已有 user/provider 产品名 → 用它
 * 2. 否则用当前 tab 展示名（OSC / cwd，与用户所见一致）
 * 3. 再否则 catalog·项目占位
 */
export function currentAgentSessionTitle(panelId: string): string | undefined {
  const activity = useForegroundActivityStore.getState().activities[panelId];
  if (activity?.kind !== "agent") {
    return;
  }
  const descriptor = usePanelDescriptorStore.getState().descriptors[panelId];
  const resolved = resolveAgentSessionTitle(
    agentSessionTitleInput({
      agentId: activity.agentId,
      projectRootPath: projectPathFromContext(descriptor?.context),
      sessionTitle: activity.sessionTitle,
      sessionTitleSource: activity.sessionTitleSource,
    })
  );
  if (resolved.primary !== resolved.placeholder) {
    return resolved.primary;
  }
  const tabShort = descriptor?.display.short?.trim();
  if (tabShort) {
    return tabShort;
  }
  return resolved.primary;
}

/**
 * 打开改名对话框并写入标题。返回是否真的改名成功（用户取消 → false）。
 * @param initialTitle 调用方已算好的展示名（如活动总览的消歧标题）；缺席时自行解析。
 */
export async function promptRenameAgentSession(args: {
  initialTitle?: string | undefined;
  panelId: string;
}): Promise<boolean> {
  const { initialTitle, panelId } = args;
  if (!canRenameAgentSession(panelId)) {
    return false;
  }
  const current = initialTitle ?? currentAgentSessionTitle(panelId) ?? "";
  const next = await showAppPrompt({
    initialValue: current,
    intent: "default",
    placeholder: i18next.t("contextMenu.action.renameAgentSessionPrompt"),
    title: i18next.t("contextMenu.action.renameAgentSession"),
    validate: (value) => {
      if (normalizeAgentSessionTitle(value)) {
        return null;
      }
      return i18next.t("contextMenu.action.renameAgentSessionPrompt");
    },
  });
  if (next == null) {
    return false;
  }
  const normalized = normalizeAgentSessionTitle(next);
  if (!normalized) {
    return false;
  }
  try {
    const result = await window.pier.terminal.setSessionTitle(panelId, {
      source: "user",
      title: normalized,
    });
    if (result.ok && result.applied) {
      return true;
    }
    showAppAlert({
      title: i18next.t("contextMenu.action.renameAgentSessionFailed"),
    });
    return false;
  } catch (error) {
    showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("contextMenu.action.renameAgentSessionFailed"),
    });
    return false;
  }
}
