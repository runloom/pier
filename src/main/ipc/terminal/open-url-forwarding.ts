import type {
  TerminalOpenUrlEvent,
  TerminalOpenUrlKind,
} from "@shared/contracts/terminal.ts";
import { terminalOpenUrlEventSchema } from "@shared/contracts/terminal.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { PIER_FILE_PROTOCOL_PANEL_ID } from "@shared/terminal-local-path.ts";
import { forwardToWindow } from "./forwarding.ts";

const EXTERNAL_SCHEMES = new Set(["http", "https", "mailto"]);

export function classifyTerminalOpenUrlForMain(
  url: string
): "remote" | "filesystem" | "app-internal" {
  const trimmed = url.trim();
  if (!trimmed) {
    return "filesystem";
  }
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!protocol || protocol === "file") {
    return "filesystem";
  }
  if (protocol === "pier") {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === "file") {
        return "filesystem";
      }
    } catch {
      return "app-internal";
    }
    return "app-internal";
  }
  if (EXTERNAL_SCHEMES.has(protocol)) {
    return "remote";
  }
  return "app-internal";
}

export async function handleTerminalOpenUrl(input: {
  broadcast: (event: TerminalOpenUrlEvent) => void;
  kind: TerminalOpenUrlKind;
  openExternal: (url: string) => Promise<void>;
  panelId: string;
  url: string;
  windowId: number;
}): Promise<void> {
  const classification = classifyTerminalOpenUrlForMain(input.url);
  if (classification === "remote") {
    await input.openExternal(input.url.trim());
    return;
  }
  const event = terminalOpenUrlEventSchema.parse({
    kind: input.kind,
    panelId: input.panelId,
    url: input.url,
  });
  input.broadcast(event);
}

export function dispatchPierFileOpenUrl(input: {
  url: string;
  windowElectronId: number;
}): Promise<void> {
  return handleTerminalOpenUrl({
    broadcast: (event) => {
      forwardToWindow(
        input.windowElectronId,
        PIER_BROADCAST.TERMINAL_OPEN_URL,
        event,
        "pier-file-protocol"
      );
    },
    kind: "unknown",
    openExternal: async () => undefined,
    panelId: PIER_FILE_PROTOCOL_PANEL_ID,
    url: input.url,
    windowId: input.windowElectronId,
  });
}
