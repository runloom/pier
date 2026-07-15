import { useEffect } from "react";
import { resolveLong } from "@/components/common/document-title.tsx";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

const TITLEBAR_HEIGHT = "38px";

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

  // resolveLong 可能返回空字符串 (descriptor 字段空值降级时), `||` 而非 `??`,
  // 让空串也回退到 "Pier" — 与 document-title.tsx 的兜底行为对齐.
  const activities = useForegroundActivityStore((s) => s.activities);
  const taskRuns = useTaskRunsStore((s) => s.snapshot);
  const { running: runningCount, waiting: waitingCount } = activityCounts(
    activities,
    taskRuns
  );
  const text = (active && resolveLong(active)) || "Pier";
  return (
    <div className="app-drag relative flex h-[38px] shrink-0 items-center justify-center border-[var(--sidebar-border)] border-b bg-[var(--sidebar)]">
      <span className="select-none font-medium text-muted-foreground text-xs">
        {text}
      </span>
      {(runningCount > 0 || waitingCount > 0) && (
        <div
          className="app-no-drag absolute right-3 flex items-center gap-2 text-xs"
          data-testid="titlebar-agent-counts"
        >
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-status-info-fg">
              <span className="size-1.5 animate-pulse rounded-full bg-status-info-fg" />
              {runningCount}
            </span>
          )}
          {waitingCount > 0 && (
            <span className="flex items-center gap-1 text-status-warning-fg">
              <span className="size-1.5 rounded-full bg-status-warning-fg" />
              {waitingCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
