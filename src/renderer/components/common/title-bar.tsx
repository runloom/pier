import { useEffect } from "react";
import { AgentIndexCountsControl } from "@/components/common/agent-index-counts-control.tsx";
import { AppUpdateControl } from "@/components/common/app-update-control.tsx";
import { resolveLong } from "@/components/common/document-title.tsx";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";

const TITLEBAR_HEIGHT = "38px";

/**
 * TitleBar — macOS hiddenInset 自定义标题栏.
 *
 * 仅在 macOS 下渲染, 替代被隐藏的原生标题栏:
 * - 整条区域设为 drag region (窗口拖动手柄)
 * - 居中显示 active panel 的长形式
 * - 右侧本机 Agent Index 计数（与非 mac 顶栏共用 AgentIndexCountsControl）
 */
export function TitleBar() {
  const active = useActiveDescriptor();
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-titlebar-height",
      TITLEBAR_HEIGHT
    );
    return () => {
      document.documentElement.style.setProperty(
        "--app-titlebar-height",
        "0px"
      );
    };
  }, []);

  const text = (active && resolveLong(active)) || "Pier";

  return (
    <div className="app-drag relative flex h-[38px] shrink-0 items-center justify-center border-[var(--sidebar-border)] border-b bg-[var(--sidebar)]">
      <span className="select-none font-medium text-muted-foreground text-xs">
        {text}
      </span>
      <div className="absolute right-3 flex items-center gap-1">
        <AgentIndexCountsControl />
        <AppUpdateControl />
      </div>
    </div>
  );
}
