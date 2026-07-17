import type { TerminalOpenUrlEvent } from "@shared/contracts/terminal.ts";

export type TerminalOpenUrlHandler = (
  event: TerminalOpenUrlEvent
) => boolean | Promise<boolean>;

const handlers = new Set<TerminalOpenUrlHandler>();

export function addTerminalOpenUrlHandler(
  handler: TerminalOpenUrlHandler
): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function listTerminalOpenUrlHandlers(): readonly TerminalOpenUrlHandler[] {
  return [...handlers];
}

/** @internal test helper */
export function resetTerminalOpenUrlHandlersForTests(): void {
  handlers.clear();
}
