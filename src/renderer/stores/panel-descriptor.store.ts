import { create } from "zustand";

/**
 * PanelDescriptor — panel 向系统汇报的"如何展示"信息.
 *
 * 字段保持开放, 后续按需扩展 (tooltip / status / icon / breadcrumb 等).
 * Sink 侧约定:取不到字段时 fallback 到 short.
 */
export interface PanelDescriptor {
  /** 完整形式 — document.title / titlebar / 单 tab 模式 */
  long?: string;
  /** 当前工作目录绝对路径 — terminal 由 OSC 7 提供; 其他 panel 可不填. sink 优先消费. */
  path?: string;
  /** 紧凑形式 — tab strip 等空间受限处 */
  short: string;
}

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
 * 读取方 (经 resolveLong, 优先级 long > path > short):
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
    set((s) => ({ descriptors: { ...s.descriptors, [id]: descriptor } })),
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
