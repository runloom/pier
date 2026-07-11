import type { IDockviewPanelProps } from "dockview-react";
import { useLayoutEffect, useState } from "react";

/** panel 恢复可见或尺寸变化后，通知浮层用当前像素尺寸重算归一化位置。 */
export function useTerminalFloatingLayoutRevision(
  api: IDockviewPanelProps["api"]
): number {
  const [revision, setRevision] = useState(0);

  useLayoutEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    const dimensions = api.onDidDimensionsChange(refresh);
    const visibility = api.onDidVisibilityChange((event) => {
      if (event.isVisible) {
        refresh();
      }
    });
    refresh();
    return () => {
      dimensions.dispose();
      visibility.dispose();
    };
  }, [api]);

  return revision;
}
