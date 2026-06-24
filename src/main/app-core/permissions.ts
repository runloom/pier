import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

const REQUIRED_CAPABILITY_BY_COMMAND: Record<
  PierCommand["type"],
  PierCapability
> = {
  "app.status": "app:read",
  "commandPaletteMru.clear": "app:read",
  "commandPaletteMru.read": "app:read",
  "commandPaletteMru.record": "app:read",
  "panel.focus": "panel:control",
  "panel.list": "panel:read",
  "preferences.read": "preferences:read",
  "preferences.update": "preferences:write",
  "terminal.focus": "terminal:control",
  "terminal.list": "terminal:read",
  "terminal.open": "terminal:control",
  "window.close": "window:close",
  "window.create": "window:create",
  "window.focus": "window:focus",
  "window.list": "window:read",
  "workspace.layout.clear": "workspace:write",
  "workspace.layout.read": "workspace:read",
  "workspace.layout.save": "workspace:write",
  "workspace.open": "workspace:open",
};

export function authorizeCommand(
  command: PierCommand,
  client: PierClient
): AuthorizationResult {
  const required = REQUIRED_CAPABILITY_BY_COMMAND[command.type];
  if (client.capabilities.includes(required)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `missing capability: ${required}`,
  };
}
