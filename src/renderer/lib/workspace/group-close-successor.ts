/**
 * 组消失后的下一激活目标。
 *
 * 主路径：组级最近使用（VS Code / tmux）。冷启动 MRU 只有当前组时，
 * 用关组前几何走 pickFocusTarget（左 → 上 → 右 → 下），禁止落到创建序第一个组。
 */

import {
  type FocusDirection,
  GROUP_FOCUS_TOL_PX,
  pickFocusTarget,
} from "@/lib/workspace/focus-target.ts";
import { groupMruIds } from "@/lib/workspace/group-mru.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";

const SPATIAL_DIRECTIONS: readonly FocusDirection[] = [
  "left",
  "up",
  "right",
  "down",
];

export interface GroupCloseSuccessorCandidate {
  id: string;
  rect: DOMRect | null;
}

export interface PickGroupCloseSuccessorInput<
  T extends GroupCloseSuccessorCandidate,
> {
  closingGroupId: string | undefined;
  closingRect: DOMRect | null;
  mruIds: readonly string[];
  remaining: readonly T[];
}

export function pickGroupCloseSuccessor<T extends GroupCloseSuccessorCandidate>(
  input: PickGroupCloseSuccessorInput<T>
): T | null {
  const remaining = input.remaining.filter(
    (group) => group.id !== input.closingGroupId
  );
  if (remaining.length === 0) {
    return null;
  }

  for (const id of input.mruIds) {
    if (!id || id === input.closingGroupId) {
      continue;
    }
    const hit = remaining.find((group) => group.id === id);
    if (hit) {
      return hit;
    }
  }

  if (input.closingRect) {
    const candidates = remaining.map((group) => ({
      id: group.id,
      isActive: false,
      rect: group.rect,
    }));
    for (const direction of SPATIAL_DIRECTIONS) {
      const index = pickFocusTarget(
        input.closingRect,
        candidates,
        direction,
        GROUP_FOCUS_TOL_PX
      );
      const picked = index === null ? undefined : remaining[index];
      if (picked) {
        return picked;
      }
    }
  }

  return remaining[0] ?? null;
}

export interface GroupCloseSuccessorGroup {
  activePanel?: { id: string } | null | undefined;
  element?: unknown;
  id?: string;
  panels: readonly { id: string }[];
}

export interface GroupCloseSuccessorApi {
  groups: readonly GroupCloseSuccessorGroup[];
  panels: readonly {
    api: { setActive: () => void };
    id: string;
    view: { contentComponent: string };
  }[];
}

function groupElement(group: GroupCloseSuccessorGroup): HTMLElement | null {
  const el = group.element;
  return el instanceof HTMLElement ? el : null;
}

function groupRect(group: GroupCloseSuccessorGroup): DOMRect | null {
  return groupElement(group)?.getBoundingClientRect() ?? null;
}

function findGroupForPanel(
  api: GroupCloseSuccessorApi,
  panelId: string
): GroupCloseSuccessorGroup | undefined {
  return api.groups.find((group) =>
    group.panels.some((panel) => panel.id === panelId)
  );
}

/** 卸组前激活下一组的当前标签。返回被激活的 panel id；无处可去时 null。 */
export function activateGroupCloseSuccessor(
  api: GroupCloseSuccessorApi,
  closingPanelId: string
): string | null {
  const closingGroup = findGroupForPanel(api, closingPanelId);
  if (!closingGroup) {
    return null;
  }
  const remaining = api.groups.filter((group) => group !== closingGroup);
  if (remaining.length === 0) {
    return null;
  }

  const mruIds = groupMruIds();
  const picked = pickGroupCloseSuccessor({
    closingGroupId: closingGroup.id,
    closingRect: groupRect(closingGroup),
    mruIds,
    remaining: remaining.map((group, index) => ({
      id: group.id || `__anon-${index}`,
      rect: groupRect(group),
    })),
  });
  if (!picked) {
    return null;
  }

  const targetGroup =
    remaining.find((group) => group.id === picked.id) ??
    remaining.find(
      (group, index) => (group.id || `__anon-${index}`) === picked.id
    ) ??
    remaining[0];
  const targetPanelId =
    targetGroup?.activePanel?.id ?? targetGroup?.panels[0]?.id;
  if (!targetPanelId) {
    return null;
  }

  const result = activateWorkspacePanel(api, targetPanelId, {
    reveal: "always",
  });
  return result.ok ? targetPanelId : null;
}
