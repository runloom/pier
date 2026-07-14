import { useEffect, useState } from "react";

interface PanelVisibilityApi {
  isVisible?: boolean;
  onDidVisibilityChange?: (
    listener: (event: { isVisible: boolean }) => void
  ) => { dispose: () => void };
}

/**
 * dockview 面板可见性 → widget 轮询闸门。
 * 组件测试的 api mock 可能缺这两个成员，全部可选守卫。
 */
export function usePanelVisible(api: PanelVisibilityApi): boolean {
  const [visible, setVisible] = useState<boolean>(api.isVisible ?? true);

  useEffect(() => {
    if (typeof api.onDidVisibilityChange !== "function") {
      return;
    }
    const disposable = api.onDidVisibilityChange((event) => {
      setVisible(event.isVisible);
    });
    return () => disposable.dispose();
  }, [api]);

  return visible;
}
