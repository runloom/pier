import { resolveLong } from "@/components/common/document-title.tsx";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";

/**
 * TitleBar — macOS hiddenInset 自定义标题栏.
 *
 * 仅在 macOS 下渲染, 替代被隐藏的原生标题栏:
 * - 整条区域设为 drag region (窗口拖动手柄)
 * - 居中显示 active panel 的长形式 (resolveLong: long > path > short), 空值兜底 "Pier"
 * - 背景色 sidebar (= --muted), 与下方 dockview tab 栏同色, 消除色差
 * - 高度 38px, 为 traffic-light 按钮预留足够空间 (trafficLightPosition y:12 + 12px 按钮 + 余量)
 */
export function TitleBar() {
  const active = useActiveDescriptor();
  // resolveLong 可能返回空字符串 (descriptor 字段空值降级时), `||` 而非 `??`,
  // 让空串也回退到 "Pier" — 与 document-title.tsx 的兜底行为对齐.
  const text = (active && resolveLong(active)) || "Pier";
  return (
    <div className="app-drag flex h-[38px] shrink-0 items-center justify-center border-[var(--sidebar-border)] border-b bg-[var(--sidebar)]">
      <span className="select-none font-medium text-muted-foreground text-xs">
        {text}
      </span>
    </div>
  );
}
