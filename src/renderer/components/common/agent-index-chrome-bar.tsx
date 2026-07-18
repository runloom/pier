import { AgentIndexCountsControl } from "@/components/common/agent-index-counts-control.tsx";
import { AppUpdateControl } from "@/components/common/app-update-control.tsx";

/**
 * 非 mac：原生标题栏下的轻量顶栏，承载本机 Agent Index 计数入口
 * （与 mac TitleBar 右侧芯片同源，避免 Needs you 无可见打断面）。
 */
export function AgentIndexChromeBar() {
  return (
    <div
      className="flex h-7 shrink-0 items-center justify-end gap-1 border-[var(--sidebar-border)] border-b bg-[var(--sidebar)] px-2"
      data-testid="agent-index-chrome-bar"
    >
      <AgentIndexCountsControl />
      <AppUpdateControl />
    </div>
  );
}
