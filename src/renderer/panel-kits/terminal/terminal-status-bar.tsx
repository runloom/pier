import type {
  RendererTerminalStatusItem,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { useSyncExternalStore } from "react";
import { Notifier } from "@/lib/util/notifier.ts";

export type TerminalStatusItemContext = RendererTerminalStatusItemContext;
export type TerminalStatusItem = RendererTerminalStatusItem;

class TerminalStatusItemRegistry extends Notifier {
  private readonly items = new Map<string, TerminalStatusItem>();

  register(item: TerminalStatusItem): () => void {
    this.items.set(item.id, item);
    this.notify();
    return () => {
      if (this.items.delete(item.id)) {
        this.notify();
      }
    };
  }

  list(): readonly TerminalStatusItem[] {
    // 运行时注册对象不再承载排序;稳定输出按 id,呈现顺序由合并层
    // (manifest 声明 + 用户覆盖,见 terminal-status-bar-merge.ts)决定。
    return Array.from(this.items.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  clearForTests(): void {
    if (this.items.size === 0) {
      return;
    }
    this.items.clear();
    this.notify();
  }
}

export const terminalStatusItemRegistry = new TerminalStatusItemRegistry();

export function useTerminalStatusItems(): readonly TerminalStatusItem[] {
  useSyncExternalStore(
    (cb) => terminalStatusItemRegistry.subscribe(cb),
    () => terminalStatusItemRegistry.getVersion(),
    () => 0
  );
  return terminalStatusItemRegistry.list();
}

export function visibleTerminalStatusItems(
  items: readonly TerminalStatusItem[],
  context: TerminalStatusItemContext
): readonly TerminalStatusItem[] {
  return items.filter((item) => item.isVisible?.(context) ?? true);
}

export function hasVisibleTerminalStatusItems(
  items: readonly TerminalStatusItem[],
  context: TerminalStatusItemContext
): boolean {
  return visibleTerminalStatusItems(items, context).length > 0;
}

export function TerminalStatusBar({
  context,
  cwd,
  panelId,
  title,
}: TerminalStatusItemContext) {
  const items = useTerminalStatusItems();
  const statusContext = { context, cwd, panelId, title };
  const visibleItems = visibleTerminalStatusItems(items, statusContext);
  if (visibleItems.length === 0) {
    return null;
  }
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1 px-1.5 leading-none"
      data-testid="terminal-status-bar"
    >
      {visibleItems.map((item) => (
        <div className="min-w-0 shrink-0" key={item.id}>
          {item.render(statusContext)}
        </div>
      ))}
    </div>
  );
}
