import { useEffect } from "react";
import {
  type PanelDescriptor,
  usePanelDescriptorStore,
} from "@/stores/panel-descriptor.store.ts";

/**
 * PanelHandle — dockview panel api 的结构子集.
 *
 * 用结构类型而非 import IDockviewPanelApi 是为了让 hook 不依赖 dockview-react,
 * 任何"有 id + setTitle"的对象都能用 (便于测试 mock + 未来如果换布局库不破坏).
 * IDockviewPanelApi 形状兼容, 调用方直接传 props.api 即可.
 */
export interface PanelHandle {
  readonly id: string;
  setTitle(title: string): void;
}

/**
 * usePanelDescriptor — panel 向中心 store 注册呈现信息.
 *
 * 职责:
 * - 同步 short 到 dockview tab (api.setTitle)
 * - upsert descriptor 到 store (供 active sink 消费)
 * - 卸载时 remove
 *
 * Active 状态由 workspace-host 统一推送 store.activeId, panel 端不参与判断.
 *
 * 字段值允许显式 `undefined` (PanelDescriptor 类型已开放), sink 端 `??` 链对
 * "字段不存在"和"字段值 undefined"行为一致, 不需要在 hook 内过滤.
 */
export function usePanelDescriptor(
  panel: PanelHandle,
  descriptor: PanelDescriptor | null
): void {
  const upsert = usePanelDescriptorStore((s) => s.upsert);
  const remove = usePanelDescriptorStore((s) => s.remove);

  useEffect(() => {
    if (!descriptor) {
      remove(panel.id);
      return;
    }
    panel.setTitle(descriptor.display.short);
    upsert(panel.id, descriptor);
  }, [panel, descriptor, upsert, remove]);

  const panelId = panel.id;
  useEffect(() => () => remove(panelId), [panelId, remove]);
}
