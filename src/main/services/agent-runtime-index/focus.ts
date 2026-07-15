import type { AgentRuntimeFocusResult } from "@shared/contracts/agent-runtime-index.ts";
import { parseAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";

export interface FocusAgentPanelArgs {
  agentRef: string;
  /** 当前 Index 中是否存在该 agentRef（语义上条目仍有效）。 */
  entryExists: boolean;
  executePanelFocus(input: {
    panelId: string;
    windowId: string;
  }): Promise<RendererCommandResult>;
  resolveInternalWindowId(electronWindowId: string): string | null;
}

/**
 * 将 opaque agentRef 解析为 panel.focus（内部 windowId）。
 * FA/Index 的 windowId 是 Electron BrowserWindow.id 字符串。
 */
export async function focusAgentByRef(
  args: FocusAgentPanelArgs
): Promise<AgentRuntimeFocusResult> {
  const parsed = parseAgentRef(args.agentRef);
  if (!parsed) {
    return { status: "panel_gone" };
  }
  if (!args.entryExists) {
    return { status: "panel_gone" };
  }

  const internalWindowId = args.resolveInternalWindowId(parsed.windowId);
  if (!internalWindowId) {
    return { status: "window_gone" };
  }

  const result = await args.executePanelFocus({
    panelId: parsed.panelId,
    windowId: internalWindowId,
  });

  if (result.ok) {
    return { status: "ok" };
  }

  if (result.error.code === "not_found") {
    // send 失败且带 windowId → 窗已无 renderer；与「条目仍在 Index」竞态。
    return { status: "window_gone" };
  }

  return {
    message: result.error.message,
    status: "error",
  };
}
