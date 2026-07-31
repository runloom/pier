import { useRef } from "react";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { reportComposerSendFailure } from "../composer-helpers.ts";
import { ensureTuiInputFocus } from "../tui-input-focus.ts";

/**
 * Hold text-only pasteboard after PTY paste so Grok's async attachment-probe
 * gate does not see a leftover screenshot (matches main SUBMIT_ENTER settle).
 */
const AGENT_CLIPBOARD_SUPPRESS_HOLD_MS = 200;

/**
 * 增强输入发送编排（从 terminal-composer.tsx 抽出，守 file-size 硬顶）。
 *
 * - 光标轮询只负责提示；发送动作始终在这里实时确认，避免陈旧探针禁用功能。
 * - in-flight 守卫防止确认弹窗或终端发送期间重复提交。
 * - 发送前 ensureTuiInputFocus：仅对声明 `inputFocusProbe` 且本会话见过
 *   visible 的 agent 读探针，其中白名单可透传恢复键。未声明探针 / 读不到 /
 *   会话内证据不足一律放行。
 * - 恢复失败不再谎报「读不到状态」：提示输入框可能未聚焦，并给「仍然发送」
 *   逃生舱（草稿保留，用户可自行决定），避免探针误判时功能彻底不可用。
 * - agent 发送期间 suppress 系统剪贴板图，避免短 bracketed paste 被 Grok
 *   误挂成 `[Image #N]`（例如只输入「你好」）。
 */
export function useTerminalComposerSend(opts: {
  buildPayloadOrReport: (value: string) => string | null;
  disabled: boolean;
  onSent: () => void;
  panelId: string;
  t: (key: string) => string;
  value: string;
}): { send: () => void } {
  const { buildPayloadOrReport, disabled, onSent, panelId, t, value } = opts;
  const sendingRef = useRef(false);

  const send = () => {
    if (disabled || sendingRef.current) {
      return;
    }
    const payload = buildPayloadOrReport(value);
    if (payload == null) {
      return;
    }
    sendingRef.current = true;
    (async () => {
      const activity =
        useForegroundActivityStore.getState().activities[panelId];
      const isAgent = activity?.kind === "agent";
      if (isAgent) {
        const ready = await ensureTuiInputFocus(panelId).catch(() => false);
        if (!ready) {
          // 探针提示风险：给用户原因和继续入口，而不是静默放弃。
          const proceed = await showAppConfirm({
            body: t("terminal.composer.blockedUnfocusedBody"),
            confirmLabel: t("terminal.composer.sendAnyway"),
            intent: "default",
            title: t("terminal.composer.blockedUnfocusedTitle"),
          });
          if (!proceed) {
            return;
          }
        }
        await window.pier.clipboard.beginImageSuppress();
      }
      try {
        const result = await window.pier.terminal.sendText({
          panelId,
          submit: true,
          text: payload,
        });

        if (result.ok || result.textDelivered) {
          onSent();
          if (!result.ok) {
            reportComposerSendFailure(t, result.error ?? "");
          }
          return;
        }
        reportComposerSendFailure(t, result.error ?? "");
      } finally {
        if (isAgent) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, AGENT_CLIPBOARD_SUPPRESS_HOLD_MS);
          });
          await window.pier.clipboard.endImageSuppress();
        }
      }
    })()
      .catch((err: unknown) => {
        reportComposerSendFailure(
          t,
          err instanceof Error ? err.message : String(err)
        );
      })
      .finally(() => {
        sendingRef.current = false;
      });
  };

  return { send };
}
