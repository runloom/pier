import { useEffect } from "react";
import { useProjectStore } from "@/stores/project.store.ts";

/**
 * Project registry 桥 — 不渲染 UI。
 * 1. 挂载时 pull 全量项目列表填充 store。
 * 2. 订阅 pier://project:changed 广播增量替换。
 */
export function ProjectBridge(): null {
  useEffect(() => {
    const replace = useProjectStore.getState().replace;
    window.pier.project
      .list()
      .then(replace)
      .catch(() => undefined);
    return window.pier.project.onChanged(replace);
  }, []);
  return null;
}
