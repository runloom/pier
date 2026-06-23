import { resolveLong } from "@/components/common/document-title.tsx";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";

/**
 * TitleBar — macOS hiddenInset 自定义标题栏.
 *
 * 仅在 macOS 下渲染, 替代被隐藏的原生标题栏:
 * - 整条区域设为 drag region (窗口拖动手柄)
 * - 居中显示当前 active panel 的长形式 (resolveLong: path > long > short, 都无 fallback "Pier")
 * - 背景色 sidebar (= --muted), 与下方 dockview tab 栏同色, 消除色差
 * - 高度 38px, 为 traffic-light 按钮预留足够空间 (trafficLightPosition y:12 + 12px 按钮 + 余量)
 */
export function TitleBar() {
  const active = useActiveDescriptor();
  const text = active ? resolveLong(active) : "Pier";
  return (
    <div className="app-drag flex h-[38px] shrink-0 items-center justify-center border-[var(--sidebar-border)] border-b bg-[var(--sidebar)]">
      <span className="select-none font-medium text-muted-foreground text-xs">
        {text}
      </span>
    </div>
  );
}
