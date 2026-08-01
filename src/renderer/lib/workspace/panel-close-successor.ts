/**
 * 关闭 active tab 后的下一激活目标。
 *
 * 策略来自 preferences.panelCloseFocusPolicy：
 * - adjacent：同 group 右邻优先，否则左邻（浏览器式；VS Code 关
 *   focusRecentEditorAfterClose 时）
 * - recent：不预切 active，交给 dockview 组内 MRU（VS Code 默认）
 *
 * 关 inactive tab 时两种策略都不改当前 active。
 */

import type { PanelCloseFocusPolicy } from "@shared/contracts/preferences.ts";

export interface PanelCloseSuccessorCandidate {
  id: string;
}

/**
 * @returns 同 group 内邻接接手 panel；组内只剩自己或不在列表时为 null
 */
export function pickPanelCloseSuccessor<T extends PanelCloseSuccessorCandidate>(
  groupPanels: readonly T[],
  closingPanelId: string
): T | null {
  const index = groupPanels.findIndex((panel) => panel.id === closingPanelId);
  if (index < 0) {
    return null;
  }
  return groupPanels[index + 1] ?? groupPanels[index - 1] ?? null;
}

export interface ActivatePanelCloseSuccessorInput<
  T extends PanelCloseSuccessorCandidate & {
    api: { setActive: () => void };
  },
> {
  /** 当前 dockview active；与 closing 不同 id 时不切换（关 inactive tab） */
  activePanelId: string | null | undefined;
  closingPanelId: string;
  groupPanels: readonly T[];
  /** 缺省 adjacent，与产品默认一致 */
  policy?: PanelCloseFocusPolicy;
}

/**
 * 若策略为 adjacent 且正在关闭当前 active，先 `setActive(successor)`，
 * 再让调用方 `removePanel`，从而覆盖 dockview 默认 MRU。
 * recent 策略返回 null，由 dockview 在 remove 时按 MRU 打开。
 */
export function activatePanelCloseSuccessor<
  T extends PanelCloseSuccessorCandidate & {
    api: { setActive: () => void };
  },
>(input: ActivatePanelCloseSuccessorInput<T>): T | null {
  if (input.activePanelId !== input.closingPanelId) {
    return null;
  }
  if ((input.policy ?? "adjacent") === "recent") {
    return null;
  }
  const successor = pickPanelCloseSuccessor(
    input.groupPanels,
    input.closingPanelId
  );
  if (!successor) {
    return null;
  }
  successor.api.setActive();
  return successor;
}
