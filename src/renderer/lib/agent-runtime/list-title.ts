/**
 * 智能体列表主标题解析——与终端 tab short 完全一致（列表侧唯一实现）。
 *
 * tab short 的解析链唯一实现仍在 panel-kits/terminal/tab-chrome.ts 的
 * terminalPanelDescriptor（chrome → OSC → cwd）。列表不重算 tab：
 * - 本窗面板：直接消费 PanelDescriptorStore 已解析的 display.short
 *   （与 tab 逐字一致，OSC / 改名变化即随动）；
 * - 跨窗 / descriptor 尚未注册：按 tab 优先级降级——user 钉名 → cwd
 *   叶子名（路径型 OSC 的 tab 形态）→ provider 产品名 → catalog 标签。
 *
 * 治理：Index quickpick / 活动总览行 / 协作会话列表必须共用本 resolver，
 * 禁止各自 resolveAgentSessionTitle——否则列表与 tab 无法一一对应。
 */

import {
  agentSessionTitleInput,
  resolveAgentSessionTitle,
} from "@shared/agent-session-title/index.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentSessionTitleSource } from "@shared/contracts/foreground-activity.ts";
import type { PanelDescriptor } from "@shared/contracts/panel.ts";

export interface AgentListTitleInput {
  agentId: AgentKind;
  cwd?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
  /** 本窗面板已解析的 tab short（PanelDescriptor.display.short）。 */
  tabShort?: string | null | undefined;
}

/**
 * 本窗 descriptors → panelId→display.short 映射。
 * Index quickpick 与协作会话列表共用（禁止各自手写映射循环）。
 */
export function tabShortByPanelIdFrom(
  descriptors: Readonly<Record<string, PanelDescriptor | undefined>>
): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const [panelId, descriptor] of Object.entries(descriptors)) {
    const short = descriptor?.display?.short?.trim();
    if (short) {
      map[panelId] = short;
    }
  }
  return map;
}

/**
 * 列表主标题。优先级与 tab 完全一致：
 * 1. 已解析 tab short（本窗，逐字同 tab）
 * 2. user 钉名（跨窗 tab 的 chrome 覆盖）
 * 3. cwd 叶子名（路径型 OSC / 无 OSC 的 tab 形态）
 * 4. provider 产品名（无路径依据时的最后可读信号）
 * 5. catalog 标签
 */
export function resolveAgentListTitle(input: AgentListTitleInput): string {
  const tabShort = input.tabShort?.trim();
  if (tabShort) {
    return tabShort;
  }
  if (input.sessionTitleSource === "user") {
    const userTitle = input.sessionTitle?.trim();
    if (userTitle) {
      return userTitle;
    }
  }
  const resolved = resolveAgentSessionTitle(
    agentSessionTitleInput({
      agentId: input.agentId,
      ...(input.cwd == null || input.cwd === "" ? {} : { cwd: input.cwd }),
      ...(input.sessionTitle == null || input.sessionTitle === ""
        ? {}
        : { sessionTitle: input.sessionTitle }),
      ...(input.sessionTitleSource == null
        ? {}
        : { sessionTitleSource: input.sessionTitleSource }),
    })
  );
  // 路径型 OSC / 无 OSC 时 tab short 是 cwd 叶子名（= secondary），优先于
  // provider 产品名——tab 上从不出现 provider 标题。
  if (resolved.secondary !== undefined) {
    return resolved.secondary;
  }
  return resolved.primary === resolved.placeholder
    ? resolved.placeholder
    : resolved.primary;
}
