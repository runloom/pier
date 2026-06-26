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
  "panel.open": "workspace:open",
  "preferences.read": "preferences:read",
  "preferences.update": "preferences:write",
  "terminal.open": "workspace:open",
  "terminal.profile.delete": "terminal:control",
  "terminal.profile.list": "terminal:read",
  "terminal.profile.read": "terminal:read",
  "terminal.profile.upsert": "terminal:control",
  "window.close": "window:close",
  "window.create": "window:create",
  "window.focus": "window:focus",
  "window.list": "window:read",
  "workspace.layout.clear": "workspace:write",
  "workspace.layout.read": "workspace:read",
  "workspace.layout.save": "workspace:write",
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
