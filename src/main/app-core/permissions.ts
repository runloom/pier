import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

const REQUIRED_CAPABILITY_BY_COMMAND: Record<
  PierCommand["type"],
  PierCapability | readonly PierCapability[]
> = {
  "app.status": "app:read",
  "commandPaletteMru.clear": "app:read",
  "commandPaletteMru.read": "app:read",
  "commandPaletteMru.record": "app:read",
  "panel.focus": "panel:control",
  "panel.list": "panel:read",
  "panel.open": "workspace:open",
  "plugin.inspect": "plugin:read",
  "plugin.list": "plugin:read",
  "preferences.read": "preferences:read",
  "preferences.update": "preferences:write",
  "window.close": "window:close",
  "window.create": "window:create",
  "window.focus": "window:focus",
  "window.list": "window:read",
  "worktree.create": "worktree:write",
  "worktree.list": "worktree:read",
  "worktree.open": ["worktree:read", "workspace:open"],
  "worktree.remove": "worktree:write",
  "workspace.layout.clear": "workspace:write",
  "workspace.layout.read": "workspace:read",
  "workspace.layout.save": "workspace:write",
};

export function authorizeCommand(
  command: PierCommand,
  client: PierClient
): AuthorizationResult {
  const required = REQUIRED_CAPABILITY_BY_COMMAND[command.type];
  if (!required) {
    return {
      ok: false,
      reason: `missing command capability mapping: ${command.type}`,
    };
  }
  const requiredCapabilities = Array.isArray(required) ? required : [required];
  const missing = requiredCapabilities.find(
    (capability) => !client.capabilities.includes(capability)
  );
  if (!missing) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `missing capability: ${missing}`,
  };
}
