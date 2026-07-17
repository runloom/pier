import {
  listTerminalOpenUrlHandlers,
  resetTerminalOpenUrlHandlersForTests as resetHandlers,
} from "@plugins/api/terminal-open-url-handlers.ts";
import type { TerminalOpenUrlEvent } from "@shared/contracts/terminal.ts";
import { toast } from "sonner";

let hostInstalled = false;
let unsubscribe: (() => void) | null = null;

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function absoluteLocalPathCandidate(url: string): string | null {
  const raw = url.trim();
  if (!raw) {
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(raw) &&
    !raw.toLowerCase().startsWith("file:")
  ) {
    return null;
  }
  if (raw.toLowerCase().startsWith("file:")) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "file:") {
        return null;
      }
      let pathname = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname.length > 0 ? pathname : null;
    } catch {
      return null;
    }
  }
  return isAbsolutePath(raw) ? raw : null;
}

async function dispatch(event: TerminalOpenUrlEvent): Promise<void> {
  for (const handler of listTerminalOpenUrlHandlers()) {
    if (await handler(event)) {
      return;
    }
  }
  const absolutePath = absoluteLocalPathCandidate(event.url);
  if (!absolutePath) {
    return;
  }
  const result = await window.pier.files.openPath({ path: absolutePath });
  if (!result.opened) {
    toast.error("Unable to open path.");
  }
}

export function installTerminalOpenUrlHost(): () => void {
  if (hostInstalled) {
    return () => undefined;
  }
  const onOpenUrl = window.pier?.terminal?.onOpenUrl;
  if (typeof onOpenUrl !== "function") {
    // Unit harnesses often mock a partial `window.pier`; skip host install until
    // a full terminal API is present (real app always provides onOpenUrl).
    return () => undefined;
  }
  hostInstalled = true;
  unsubscribe = onOpenUrl((event) => {
    dispatch(event).catch((error: unknown) => {
      console.error("[terminal-open-url-host] dispatch failed:", error);
    });
  });
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    hostInstalled = false;
    resetHandlers();
  };
}

/** @internal test helper */
export function resetTerminalOpenUrlHostForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  hostInstalled = false;
  resetHandlers();
}
