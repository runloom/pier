import type {
  TerminalOpenUrlEvent,
  TerminalOpenUrlKind,
} from "@shared/contracts/terminal.ts";
import { terminalOpenUrlEventSchema } from "@shared/contracts/terminal.ts";

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
