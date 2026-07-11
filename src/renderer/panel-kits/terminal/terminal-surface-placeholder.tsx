import { cn } from "@pier/ui/utils.ts";

interface TerminalSurfacePlaceholderProps {
  className: string;
}

/**
 * 终端表面占位：resize 期间及 native 终端首次就绪前，用终端主题背景色顶替 native
 * 终端区域，避免几何瞬变时看到窗口底色。不带 marker，与真实终端 buffer 底色无缝衔接。
 */
export function TerminalSurfacePlaceholder({
  className,
}: TerminalSurfacePlaceholderProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none bg-[var(--terminal-background,var(--background))]",
        className
      )}
      data-testid="terminal-placeholder"
    />
  );
}
