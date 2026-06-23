/**
 * Keybinding scope 状态容器。Web 是 source of truth — workspace-host 监听
 * dockview onDidActivePanelChange 调 setActivePanel; command-palette / dialog
 * mount/unmount 调 pushOverlay/popOverlay。swift 通过 IPC 收 setActivePanelKind
 * 同步 mirror state 决定 firstResponder swap。
 *
 * resolve 优先级 (use-keybindings.pickAction 内消费):
 *   1. overlayStack 顶 → only top overlay scope (阻断, 不 fall through to panel/global)
 *   2. activePanelComponent → panel:<component> scope, miss 再 fall through
 *   3. global scope (default fallback)
 */
import { create } from "zustand";

export type PanelKind = "terminal" | "web";

export interface KeybindingScopeState {
  activePanelComponent: string | null;
  activePanelId: string | null;
  activePanelKind: PanelKind | null;
  /** Overlay scope id 栈 (支持 nested overlay, 例: command-palette → quick-pick)。 */
  overlayStack: string[];
  popOverlay(id: string): void;
  pushOverlay(id: string): void;

  setActivePanel(
    kind: PanelKind | null,
    component: string | null,
    panelId: string | null
  ): void;
}

export const useKeybindingScope = create<KeybindingScopeState>((set) => ({
  activePanelKind: null,
  activePanelComponent: null,
  activePanelId: null,
  overlayStack: [],

  setActivePanel: (kind, component, panelId) =>
    set({
      activePanelKind: kind,
      activePanelComponent: component,
      activePanelId: panelId,
    }),

  pushOverlay: (id) =>
    set((state) => ({ overlayStack: [...state.overlayStack, id] })),

  popOverlay: (id) =>
    set((state) => {
      // pop 仅当 id 是栈顶 (规范使用), 否则按 LIFO 移除该 id 的最后一次出现
      const idx = state.overlayStack.lastIndexOf(id);
      if (idx === -1) {
        return {};
      }
      const next = [...state.overlayStack];
      next.splice(idx, 1);
      return { overlayStack: next };
    }),
}));
