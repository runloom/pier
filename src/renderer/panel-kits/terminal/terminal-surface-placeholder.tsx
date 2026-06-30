import { SquareTerminal } from "lucide-react";
import { basename } from "./terminal-tab-chrome.ts";

interface TerminalSurfacePlaceholderProps {
  className: string;
  cwd: string | null;
  tabTitle: string | null;
  title: string | null;
}

/**
 * 终端表面占位：resize 期间（及 native 终端首次就绪前）顶替 native 终端区域。
 * 标识优先取 tab 标题 / 终端标题 / 目录名；颜色跟随当前终端主题。
 */
export function TerminalSurfacePlaceholder({
  className,
  cwd,
  tabTitle,
  title,
}: TerminalSurfacePlaceholderProps) {
  const label = tabTitle ?? title ?? (cwd ? basename(cwd) : "Terminal");
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none flex items-center justify-center bg-[var(--terminal-background,var(--background))] ${className}`}
      data-testid="terminal-placeholder"
    >
      <div
        className="flex min-w-0 max-w-full flex-col items-center gap-2.5 px-6 text-center opacity-40"
        style={{ color: "var(--terminal-foreground, var(--muted-foreground))" }}
      >
        <SquareTerminal aria-hidden="true" className="size-8" />
        <span className="max-w-full truncate font-medium text-sm">{label}</span>
      </div>
    </div>
  );
}
