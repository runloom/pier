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
    return Array.from(this.items.values()).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
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

export function TerminalStatusBar({
  context,
  cwd,
  panelId,
  title,
}: TerminalStatusItemContext) {
  const items = useTerminalStatusItems();
  if (items.length === 0) {
    return null;
  }
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-6 min-w-0 items-center gap-2 border-border/60 border-t bg-background/95 px-2 text-muted-foreground text-xs"
      data-testid="terminal-status-bar"
    >
      {items.map((item) => (
        <div className="min-w-0 shrink-0" key={item.id}>
          {item.render({ context, cwd, panelId, title })}
        </div>
      ))}
    </div>
  );
}
