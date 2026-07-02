import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

/**
 * 每条命令一行元数据:
 *   capabilities —— 授权层要求的能力集 (authorizeCommand 校验)
 *
 * 单一真源:加命令时 TypeScript 的 Record 全 key 类型强制必须填 capabilities,
 * 避免遗漏授权配置。所有命令统一经 PIER.COMMAND_EXECUTE 通用 IPC 通道路由,
 * 能力校验是唯一的调用门槛 (无 renderer 专属白名单概念)。
 */
export interface CommandMetadata {
  readonly capabilities: readonly PierCapability[];
}

const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  "app.status": { capabilities: ["app:read"] },
  "commandPaletteMru.clear": { capabilities: ["app:read"] },
  "commandPaletteMru.read": { capabilities: ["app:read"] },
  "commandPaletteMru.record": { capabilities: ["app:read"] },
  "panel.focus": { capabilities: ["panel:control"] },
  "panel.list": { capabilities: ["panel:read"] },
  "panel.open": { capabilities: ["workspace:open"] },
  "plugin.disable": { capabilities: ["plugin:write"] },
  "plugin.enable": { capabilities: ["plugin:write"] },
  "plugin.inspect": { capabilities: ["plugin:read"] },
  "plugin.list": { capabilities: ["plugin:read"] },
  "pluginSettings.getAll": { capabilities: ["plugin:read"] },
  "pluginSettings.reset": { capabilities: ["plugin:write"] },
  "pluginSettings.set": { capabilities: ["plugin:write"] },
  "preferences.read": { capabilities: ["preferences:read"] },
  "preferences.update": { capabilities: ["preferences:write"] },
  "run.cancel": { capabilities: ["workspace:open"] },
  "run.list": { capabilities: ["workspace:read"] },
  "run.recent": { capabilities: ["workspace:read"] },
  "run.spawn": { capabilities: ["workspace:open"] },
  "run.status": { capabilities: ["workspace:read"] },
  // terminal.open 静态元数据只记基础 capabilities;launch 存在时的额外
  // 能力由 requiredCapabilitiesForCommand 动态叠加。
  "terminal.open": { capabilities: ["workspace:open"] },
  "terminal.profile.delete": { capabilities: ["terminal:control"] },
  "terminal.profile.list": { capabilities: ["terminal:read"] },
  "terminal.profile.read": { capabilities: ["terminal:read"] },
  "terminal.profile.upsert": { capabilities: ["terminal:control"] },
  "terminalStatusBar.prefs.applyOverrides": {
    capabilities: ["preferences:write"],
  },
  "terminalStatusBar.prefs.getAll": { capabilities: ["preferences:read"] },
  "terminalStatusBar.prefs.resetItem": {
    capabilities: ["preferences:write"],
  },
  "terminalStatusBar.prefs.setItemOverride": {
    capabilities: ["preferences:write"],
  },
  "window.close": { capabilities: ["window:close"] },
  "window.create": { capabilities: ["window:create"] },
  "window.focus": { capabilities: ["window:focus"] },
  "window.list": { capabilities: ["window:read"] },
  "worktree.check": { capabilities: ["worktree:read"] },
  "worktree.create": { capabilities: ["worktree:write"] },
  "worktree.creationDefaults": { capabilities: ["worktree:read"] },
  "worktree.list": { capabilities: ["worktree:read"] },
  "worktree.open": {
    capabilities: ["worktree:read", "workspace:open"],
  },
  "worktree.openTerminal": { capabilities: ["worktree:write"] },
  "worktree.prune": { capabilities: ["worktree:write"] },
  "worktree.remove": { capabilities: ["worktree:write"] },
  "workspace.layout.clear": { capabilities: ["workspace:write"] },
  "workspace.layout.read": { capabilities: ["workspace:read"] },
  "workspace.layout.save": { capabilities: ["workspace:write"] },
  "file.list": { capabilities: ["file:read"] },
  "file.move": { capabilities: ["file:write"] },
  "file.readText": { capabilities: ["file:read"] },
  "file.rename": { capabilities: ["file:write"] },
  "file.trash": { capabilities: ["file:write"] },
  "file.writeText": { capabilities: ["file:write"] },
  // Git 读写分开授权:读命令 git:read, 写命令 git:write。
  "git.checkoutBranch": { capabilities: ["git:write"] },
  "git.commit": { capabilities: ["git:write"] },
  "git.createBranch": { capabilities: ["git:write"] },
  "git.deleteBranch": { capabilities: ["git:write"] },
  "git.discardChanges": { capabilities: ["git:write"] },
  "git.getCommit": { capabilities: ["git:read"] },
  "git.getCommitPatch": { capabilities: ["git:read"] },
  "git.getDiffPatch": { capabilities: ["git:read"] },
  "git.getDiffSummary": { capabilities: ["git:read"] },
  "git.getDiffText": { capabilities: ["git:read"] },
  "git.getFileContent": { capabilities: ["git:read"] },
  "git.getLog": { capabilities: ["git:read"] },
  "git.getRepoInfo": { capabilities: ["git:read"] },
  "git.getStatus": { capabilities: ["git:read"] },
  "git.isWorkingTreeClean": { capabilities: ["git:read"] },
  "git.listBranches": { capabilities: ["git:read"] },
  "git.listTags": { capabilities: ["git:read"] },
  "git.merge": { capabilities: ["git:write"] },
  "git.mergeAbort": { capabilities: ["git:write"] },
  "git.rebase": { capabilities: ["git:write"] },
  "git.rebaseAbort": { capabilities: ["git:write"] },
  "git.rebaseContinue": { capabilities: ["git:write"] },
  "git.resolveRef": { capabilities: ["git:read"] },
  "git.searchBranches": { capabilities: ["git:read"] },
  "git.stage": { capabilities: ["git:write"] },
  "git.stash": { capabilities: ["git:write"] },
  "git.stashList": { capabilities: ["git:read"] },
  "git.stashPop": { capabilities: ["git:write"] },
  "git.undoLastCommit": { capabilities: ["git:write"] },
  "git.unstage": { capabilities: ["git:write"] },
  "git.validateBranchName": { capabilities: ["git:read"] },
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
  return COMMAND_METADATA[command.type].capabilities;
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
