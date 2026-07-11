import type {
  MissionControlGridSize,
  MissionControlPanelWidgetEntry,
} from "@shared/contracts/mission-control.ts";
import { clampSize } from "./mission-control-grid-geometry.ts";
import { moveMissionControlEntry } from "./mission-control-ordered-layout.ts";

export interface KeyboardLayoutChange {
  kind: "move" | "resize";
  widgets: MissionControlPanelWidgetEntry[];
}

export function applyKeyboardLayoutChange(
  widgets: readonly MissionControlPanelWidgetEntry[],
  instanceId: string,
  key: string,
  resize: boolean,
  sizeBounds?: {
    max: MissionControlGridSize;
    min: MissionControlGridSize;
  }
): KeyboardLayoutChange | null {
  const sourceIndex = widgets.findIndex((entry) => entry.id === instanceId);
  const current = widgets[sourceIndex];
  if (!current) return null;

  if (!resize) {
    const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
      return null;
    }
    const targetIndex = Math.max(
      0,
      Math.min(widgets.length - 1, sourceIndex + delta)
    );
    if (targetIndex === sourceIndex) return null;
    return {
      kind: "move",
      widgets: moveMissionControlEntry(widgets, instanceId, targetIndex),
    };
  }

  let preferred = { h: current.h, w: current.w };
  switch (key) {
    case "ArrowLeft":
      preferred = { ...preferred, w: preferred.w - 1 };
      break;
    case "ArrowRight":
      preferred = { ...preferred, w: preferred.w + 1 };
      break;
    case "ArrowUp":
      preferred = { ...preferred, h: preferred.h - 1 };
      break;
    case "ArrowDown":
      preferred = { ...preferred, h: preferred.h + 1 };
      break;
    default:
      return null;
  }
  const nextSize = clampSize(
    preferred,
    sizeBounds?.min ?? { h: 1, w: 1 },
    sizeBounds?.max ?? { h: 12, w: 12 }
  );
  if (nextSize.h === current.h && nextSize.w === current.w) return null;
  return {
    kind: "resize",
    widgets: widgets.map((entry) =>
      entry.id === instanceId ? { ...entry, ...nextSize } : entry
    ),
  };
}
