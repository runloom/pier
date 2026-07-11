import type { PanelDescriptor } from "@shared/contracts/panel.ts";
import { create } from "zustand";

export type { PanelDescriptor } from "@shared/contracts/panel.ts";

interface PanelDescriptorState {
  activeId: string | null;
  descriptors: Record<string, PanelDescriptor>;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  upsert: (id: string, descriptor: PanelDescriptor) => void;
}

/**
 * PanelDescriptorStore — 所有 panel 呈现信息的中心.
 *
 * 写入方:
 * - panel 端通过 usePanelDescriptor hook 注册/更新/卸载 (upsert/remove)
 * - workspace-host 通过 dockview onDidActivePanelChange 推送 activeId
 *   (同时同步 upsert 占位 descriptor, 避免 panel useEffect 异步 commit 间隙闪烁)
 *
 * 读取方 (经 resolveLong, 优先级 display.long > display.short):
 * - DocumentTitle:document.title
 * - TitleBar (macOS):自定义标题栏
 * - 未来:全局 panel 列表 / breadcrumb (消费 path) / agent 状态总览
 *
 * 不在 hook 里监听 isActive — active 唯一来源是 dockview, 集中推 store, 防止
 * N 个 panel 各自判断 active 的竞态.
 */
export const usePanelDescriptorStore = create<PanelDescriptorState>((set) => ({
  descriptors: {},
  activeId: null,
  upsert: (id, descriptor) =>
    set((s) => {
      const current = s.descriptors[id];
      if (current && JSON.stringify(current) === JSON.stringify(descriptor)) {
        return s;
      }
      return { descriptors: { ...s.descriptors, [id]: descriptor } };
    }),
  remove: (id) =>
    set((s) => {
      if (!(id in s.descriptors)) {
        return s;
      }
      const next = { ...s.descriptors };
      delete next[id];
      return { descriptors: next };
    }),
  setActive: (id) => set({ activeId: id }),
}));

export function useActiveDescriptor(): PanelDescriptor | null {
  return usePanelDescriptorStore((s) =>
    s.activeId ? (s.descriptors[s.activeId] ?? null) : null
  );
}
