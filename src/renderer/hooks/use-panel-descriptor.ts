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
 * - upsert 整个 descriptor 到 store (供 active sink 消费)
 * - 卸载时 remove
 *
 * Active 状态由 workspace-host 统一推送 store.activeId, panel 端不参与判断.
 */
export function usePanelDescriptor(
  panel: PanelHandle,
  descriptor: PanelDescriptor
): void {
  const { short, long, path } = descriptor;
  const upsert = usePanelDescriptorStore((s) => s.upsert);
  const remove = usePanelDescriptorStore((s) => s.remove);

  useEffect(() => {
    panel.setTitle(short);
    // exactOptionalPropertyTypes — 按字段是否定义条件构造, 不显式写 undefined.
    const next: PanelDescriptor = { short };
    if (long !== undefined) {
      next.long = long;
    }
    if (path !== undefined) {
      next.path = path;
    }
    upsert(panel.id, next);
    return () => remove(panel.id);
  }, [panel, short, long, path, upsert, remove]);
}
