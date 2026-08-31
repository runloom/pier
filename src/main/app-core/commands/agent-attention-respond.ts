/**
 * agent.attention.respond（M1 移动端审批回写）。
 *
 * 地址两形态（M2 修订：窗口概念不出宿主）：
 * - 完整引用 makeAgentRef(windowId, panelId)——桌面 renderer；
 * - 裸 panelId（面板寻址）——移动端。面板 id 随布局持久化、跨窗口迁移
 *   不变；宿主从 FA 快照解析当前窗口，无匹配或歧义（两窗同 id）一律
 *   fail closed 转 interaction_stale。
 *
 * 双重门（任一不过 → interaction_stale）：
 * 1. 未决交互注册表 assertCurrent(agentRef, interactionId)；
 * 2. FA 快照中该 agentRef 当前 status === waiting。
 *
 * 终端写禁令豁免：executeTerminalSendCommand 面向任意文本注入；本命令
 * 只发 13 个固定审批键的单字节序列（enter/escape/y/n/1-9），且必须先过
 * 双重门。此处直接 getTerminalAddon().sendText 是有意收窄的例外——
 * 不得扩展为通用文本写，也不得被其他命令复用为绕过 terminal.send 的捷径。
 */
import {
  makeAgentRef,
  parseAgentRef,
} from "@shared/contracts/agent/runtime-index.ts";
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { getTerminalAddon } from "../../ipc/terminal/index.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { resolveNativeKey } from "./terminal-locate.ts";

type RespondCommand = Extract<PierCommand, { type: "agent.attention.respond" }>;

const KEY_BYTES: Record<RespondCommand["key"], string> = {
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  enter: "\r",
  escape: "\u001b",
  n: "n",
  y: "y",
};

function isWaiting(services: PierCoreServices, agentRef: string): boolean {
  try {
    const snapshot = services.foregroundActivity?.snapshot();
    if (!snapshot) {
      return false;
    }
    return snapshot.activities.some(
      (activity) =>
        activity.kind === "agent" &&
        activity.status === "waiting" &&
        makeAgentRef(activity.windowId, activity.panelId) === agentRef
    );
  } catch {
    return false;
  }
}

/**
 * 裸 panelId → 完整 agentRef：从 FA 快照找该面板的唯一 agent 活动。
 * 完整引用原样通过；无匹配或跨窗歧义 → null（fail closed）。
 */
function resolveRespondRef(
  services: PierCoreServices,
  raw: string
): string | null {
  if (parseAgentRef(raw) !== null) {
    return raw;
  }
  try {
    const snapshot = services.foregroundActivity?.snapshot();
    const matches = (snapshot?.activities ?? []).filter(
      (activity) => activity.kind === "agent" && activity.panelId === raw
    );
    const only = matches.length === 1 ? matches[0] : undefined;
    return only === undefined ? null : makeAgentRef(only.windowId, raw);
  } catch {
    return null;
  }
}

export async function executeAgentAttentionRespondCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  if (command.type !== "agent.attention.respond") {
    return null;
  }
  const agentRef = resolveRespondRef(services, command.agentRef);
  if (agentRef === null) {
    return failure(
      requestId,
      "interaction_stale",
      `agent panel not found: ${command.agentRef}`
    );
  }
  const registry = services.pendingInteractions;
  if (!registry?.assertCurrent(agentRef, command.interactionId)) {
    return failure(
      requestId,
      "interaction_stale",
      `interaction not pending: ${command.interactionId}`
    );
  }
  if (!isWaiting(services, agentRef)) {
    return failure(
      requestId,
      "interaction_stale",
      "agent is not waiting for interaction"
    );
  }
  // 过了注册表门的 agentRef 必为 makeAgentRef 产物；parse 失败属防御分支。
  const ref = parseAgentRef(agentRef);
  if (!ref) {
    return failure(
      requestId,
      "invalid_command",
      `malformed agentRef: ${agentRef}`
    );
  }
  const nativeKey = resolveNativeKey(ref.panelId, ref.windowId);
  const addon = getTerminalAddon();
  if (!(nativeKey && addon)) {
    return failure(
      requestId,
      "platform_unavailable",
      "terminal native backend unavailable"
    );
  }
  const ok = addon.sendText(nativeKey, KEY_BYTES[command.key]);
  if (!ok) {
    return failure(
      requestId,
      "platform_unavailable",
      "agent.attention.respond failed"
    );
  }
  return success(requestId, { accepted: true });
}
