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
  "pluginSettings.getAll": ["plugin:read"],
  "pluginSettings.reset": ["plugin:write"],
  "pluginSettings.set": ["plugin:write"],
  "preferences.read": ["preferences:read"],
  "preferences.update": ["preferences:write"],
  "run.list": ["workspace:read"],
  "run.cancel": ["workspace:open"],
  "run.recent": ["workspace:read"],
  "run.spawn": ["workspace:open"],
  "run.status": ["workspace:read"],
  "terminal.open": ["workspace:open"],
  "terminal.profile.delete": ["terminal:control"],
  "terminal.profile.list": ["terminal:read"],
  "terminal.profile.read": ["terminal:read"],
  "terminal.profile.upsert": ["terminal:control"],
  "terminalStatusBar.prefs.applyOverrides": ["preferences:write"],
  "terminalStatusBar.prefs.getAll": ["preferences:read"],
  "terminalStatusBar.prefs.resetItem": ["preferences:write"],
  "terminalStatusBar.prefs.setItemOverride": ["preferences:write"],
  "window.close": ["window:close"],
  "window.create": ["window:create"],
  "window.focus": ["window:focus"],
  "window.list": ["window:read"],
  "worktree.check": ["worktree:read"],
  "worktree.create": ["worktree:write"],
  "worktree.list": ["worktree:read"],
  "worktree.open": ["worktree:read", "workspace:open"],
  "worktree.prune": ["worktree:write"],
  "worktree.remove": ["worktree:write"],
  "workspace.layout.clear": ["workspace:write"],
  "workspace.layout.read": ["workspace:read"],
  "workspace.layout.save": ["workspace:write"],
  "file.list": ["file:read"],
  "file.readText": ["file:read"],
  "file.writeText": ["file:write"],
  "file.rename": ["file:write"],
  "file.move": ["file:write"],
  "file.trash": ["file:write"],
  // Git 读写分开授权:读命令 git:read, 写命令 git:write。
  "git.getCommit": ["git:read"],
  "git.getCommitPatch": ["git:read"],
  "git.getDiffPatch": ["git:read"],
  "git.getDiffSummary": ["git:read"],
  "git.getDiffText": ["git:read"],
  "git.getFileContent": ["git:read"],
  "git.getLog": ["git:read"],
  "git.getRepoInfo": ["git:read"],
  "git.getStatus": ["git:read"],
  "git.isWorkingTreeClean": ["git:read"],
  "git.listBranches": ["git:read"],
  "git.searchBranches": ["git:read"],
  "git.listTags": ["git:read"],
  "git.resolveRef": ["git:read"],
  "git.validateBranchName": ["git:read"],
  "git.stage": ["git:write"],
  "git.unstage": ["git:write"],
  "git.discardChanges": ["git:write"],
  "git.commit": ["git:write"],
  "git.createBranch": ["git:write"],
  "git.deleteBranch": ["git:write"],
  "git.checkoutBranch": ["git:write"],
  "git.merge": ["git:write"],
  "git.mergeAbort": ["git:write"],
  "git.stash": ["git:write"],
  "git.stashPop": ["git:write"],
  "git.stashList": ["git:read"],
  "git.rebase": ["git:write"],
  "git.rebaseAbort": ["git:write"],
  "git.rebaseContinue": ["git:write"],
  "git.undoLastCommit": ["git:write"],
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
