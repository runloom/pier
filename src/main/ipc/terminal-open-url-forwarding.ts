import type {
  TerminalOpenUrlEvent,
  TerminalOpenUrlKind,
} from "@shared/contracts/terminal.ts";
import { terminalOpenUrlEventSchema } from "@shared/contracts/terminal.ts";

export function classifyTerminalOpenUrlForMain(
  url: string
): "remote" | "local-candidate" {
  const trimmed = url.trim();
  if (!trimmed) {
    return "local-candidate";
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) &&
    !trimmed.toLowerCase().startsWith("file:")
  ) {
    return "remote";
  }
  return "local-candidate";
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
