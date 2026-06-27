import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

const REQUIRED_CAPABILITIES_BY_COMMAND: Record<
  PierCommand["type"],
  readonly PierCapability[]
> = {
  "app.status": ["app:read"],
  "commandPaletteMru.clear": ["app:read"],
  "commandPaletteMru.read": ["app:read"],
  "commandPaletteMru.record": ["app:read"],
  "panel.focus": ["panel:control"],
  "panel.list": ["panel:read"],
  "panel.open": ["workspace:open"],
  "plugin.inspect": ["plugin:read"],
  "plugin.disable": ["plugin:write"],
  "plugin.enable": ["plugin:write"],
  "plugin.list": ["plugin:read"],
  "preferences.read": ["preferences:read"],
  "preferences.update": ["preferences:write"],
  "run.list": ["workspace:read"],
  "run.spawn": ["workspace:open"],
  "terminal.open": ["workspace:open"],
  "terminal.profile.delete": ["terminal:control"],
  "terminal.profile.list": ["terminal:read"],
  "terminal.profile.read": ["terminal:read"],
  "terminal.profile.upsert": ["terminal:control"],
  "window.close": ["window:close"],
  "window.create": ["window:create"],
  "window.focus": ["window:focus"],
  "window.list": ["window:read"],
  "worktree.check": ["worktree:read"],
  "worktree.create": ["worktree:write"],
  "worktree.list": ["worktree:read"],
  "worktree.open": ["worktree:read", "workspace:open"],
  "worktree.remove": ["worktree:write"],
  "workspace.layout.clear": ["workspace:write"],
  "workspace.layout.read": ["workspace:read"],
  "workspace.layout.save": ["workspace:write"],
};

function terminalOpenCapabilities(
  command: Extract<PierCommand, { type: "terminal.open" }>
): readonly PierCapability[] {
  if (command.launch && Object.keys(command.launch).length > 0) {
    return ["workspace:open", "terminal:control"];
  }
  return ["workspace:open"];
}

function requiredCapabilitiesForCommand(
  command: PierCommand
): readonly PierCapability[] {
  if (command.type === "terminal.open") {
    return terminalOpenCapabilities(command);
  }
  return REQUIRED_CAPABILITIES_BY_COMMAND[command.type];
}

export function authorizeCommand(
  command: PierCommand,
  client: PierClient
): AuthorizationResult {
  const requiredCapabilities = requiredCapabilitiesForCommand(command);
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
