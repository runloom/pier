import type {
  PierDockviewGroupHandle,
  PierDockviewPanelHandle,
} from "@shared/contracts/dockview.ts";
import { useEffect, useRef, useState } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";

/**
 * 拉取式读取 group 的「当前 files 面板」:
 * - 权威数据源是 dockview 本身(group.activePanel + panel.params)。
 * - active 是非 files 面板时保持最近一次 files 面板；host 会隐藏本视图。
 * - mount / group 切换后 rAF 再读一次，避免跨 group 拖拽时错过
 *   onDidActivePanelChange 的瞬时事件导致空白内容。
 */
export function useActiveFilesPanel(
  group: PierDockviewGroupHandle
): PierDockviewPanelHandle | null {
  const [, forceRead] = useState(0);
  const lastFilesPanelRef = useRef<PierDockviewPanelHandle | null>(null);

  const readActive = (): PierDockviewPanelHandle | null => {
    const active = group.model?.activePanel ?? group.activePanel ?? null;
    if (active?.view?.contentComponent === FILES_FILE_PANEL_ID) {
      lastFilesPanelRef.current = active;
      return active;
    }
    return lastFilesPanelRef.current;
  };

  useEffect(() => {
    lastFilesPanelRef.current = null;
    const bump = () => forceRead((revision) => revision + 1);
    const activeDisposable = group.api.onDidActivePanelChange(bump);
    // 跨 group 拖入时 active 可能已先于订阅变更；立刻 + 下一帧各读一次。
    bump();
    const raf = requestAnimationFrame(bump);
    return () => {
      cancelAnimationFrame(raf);
      activeDisposable.dispose();
    };
  }, [group]);

  const panel = readActive();

  useEffect(() => {
    const disposable = panel?.api?.onDidParametersChange?.(() => {
      forceRead((revision) => revision + 1);
    });
    return () => {
      disposable?.dispose();
    };
  }, [panel]);

  return panel;
}
