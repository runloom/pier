import type { AgentAttentionSettings } from "@shared/contracts/agent-attention.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

/**
 * 通知设置共用：patch agentAttention 并在失败时弹出保存失败详情。
 * notifications-section 与 notification-sound-block 共用，避免各自复制。
 */
export async function patchAttention(
  patch: Partial<AgentAttentionSettings>,
  setAgentAttention: (
    next:
      | AgentAttentionSettings
      | ((current: AgentAttentionSettings) => AgentAttentionSettings)
  ) => Promise<void>,
  failedTitle: string
): Promise<void> {
  try {
    await setAgentAttention((current) => ({ ...current, ...patch }));
  } catch (err) {
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: failedTitle,
    });
  }
}
