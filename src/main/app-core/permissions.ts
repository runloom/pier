import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
  PierClientKind,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

/**
 * 每条命令一行元数据:
 *   capabilities —— 授权层要求的能力集 (authorizeCommand 校验)
 *   allowedClientKinds —— 可选. 若定义, 仅列表中的 client kind 允许通过; 未列出的 kind
 *     在 capability 校验前就被拒绝. 缺省时沿用纯 capability 校验(现有命令的默认行为).
 *
 * 单一真源:加命令时 TypeScript 的 Record 全 key 类型强制必须填 capabilities,
 * 避免遗漏授权配置。allowedClientKinds 用于 managed plugin 命令这类 "某些客户端
 * 只读、某些不可写" 的场景(design §7.0), 未来同类命令沿用同一模式。所有命令统一
 * 经 PIER.COMMAND_EXECUTE 通用 IPC 通道路由。
 */
export interface CommandMetadata {
  readonly allowedClientKinds?: readonly PierClientKind[];
  readonly capabilities: readonly PierCapability[];
}

const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  "ai.status": { capabilities: ["ai:invoke"] },
  "ai.generateText": { capabilities: ["ai:invoke"] },
  "environment.project.add": { capabilities: ["environment:write"] },
  "environment.project.remove": { capabilities: ["environment:write"] },
  "environment.snapshot": { capabilities: ["environment:read"] },
  "environment.update": { capabilities: ["environment:write"] },
  "environment.worktreeBinding": { capabilities: ["environment:read"] },
  "app.status": { capabilities: ["app:read"] },
  "appUpdate.status": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read"],
  },
  "appUpdate.check": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read", "network"],
  },
  "appUpdate.download": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read", "network"],
  },
  "appUpdate.quitAndInstall": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
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
  "run.backgroundSnapshot": { capabilities: ["workspace:read"] },
  "run.runsSnapshot": { capabilities: ["workspace:read"] },
  "run.list": { capabilities: ["workspace:read"] },
  "run.recent": { capabilities: ["workspace:read"] },
  "run.spawn": { capabilities: ["workspace:open"] },
  "run.status": { capabilities: ["workspace:read"] },
  "run.stop": { capabilities: ["workspace:open"] },
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
  "file.readDocument": { capabilities: ["file:read"] },
  "file.readText": { capabilities: ["file:read"] },
  "file.trash": { capabilities: ["file:write"] },
  "file.writeDocument": { capabilities: ["file:write"] },
  "file.writeText": { capabilities: ["file:write"] },
  "file.inspectWriteTarget": { capabilities: ["file:write"] },
  "file.inspectPathImpact": { capabilities: ["file:read"] },
  "file.confirmDurability": { capabilities: ["file:write"] },
  "file.mkdir": { capabilities: ["file:write"] },
  "file.exists": { capabilities: ["file:read"] },
  "file.stat": { capabilities: ["file:read"] },
  "file.copy": { capabilities: ["file:write"] },
  "file.reveal": { capabilities: ["file:read"] },
  "file.drafts.listKeys": { capabilities: ["file:read"] },
  "file.drafts.listDiagnostics": { capabilities: ["file:read"] },
  "file.drafts.get": { capabilities: ["file:read"] },
  "file.drafts.set": { capabilities: ["file:write"] },
  "file.drafts.delete": { capabilities: ["file:write"] },
  "file.drafts.claimLegacy": { capabilities: ["file:write"] },
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
  "git.getReviewIndex": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.getReviewFileDocument": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.cancelReviewRequest": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.listIgnored": { capabilities: ["git:read"] },
  "git.isWorkingTreeClean": { capabilities: ["git:read"] },
  "git.listBranches": { capabilities: ["git:read"] },
  "git.listTags": { capabilities: ["git:read"] },
  "git.merge": { capabilities: ["git:write"] },
  "git.mergeAbort": { capabilities: ["git:write"] },
  "git.pullFastForward": { capabilities: ["git:write"] },
  "git.push": { capabilities: ["git:write"] },
  "git.rebase": { capabilities: ["git:write"] },
  "git.rebaseAbort": { capabilities: ["git:write"] },
  "git.rebaseContinue": { capabilities: ["git:write"] },
  "git.resolveRef": { capabilities: ["git:read"] },
  "git.searchBranches": { capabilities: ["git:read"] },
  "git.stage": { capabilities: ["git:write"] },
  "git.stash": { capabilities: ["git:write"] },
  "git.stashApply": { capabilities: ["git:write"] },
  "git.stashDrop": { capabilities: ["git:write"] },
  "git.stashList": { capabilities: ["git:read"] },
  "git.stashPop": { capabilities: ["git:write"] },
  "git.sync": { capabilities: ["git:write"] },
  "git.undoLastCommit": { capabilities: ["git:write"] },
  "git.unstage": { capabilities: ["git:write"] },
  "git.validateBranchName": { capabilities: ["git:read"] },
  "plugin.catalog.list": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["plugin:read"],
  },
  "plugin.checkUpdates": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write", "network"],
  },
  "plugin.install": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write", "network"],
  },
  "plugin.update": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write", "network"],
  },
  "plugin.rollback": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write"],
  },
  "plugin.uninstall": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write"],
  },
  "plugin.devOverride.set": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write"],
  },
  "plugin.devOverride.clear": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["plugin:write"],
  },
  "app.relaunch": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
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
  const allowedKinds = COMMAND_METADATA[command.type].allowedClientKinds;
  if (allowedKinds && !allowedKinds.includes(client.kind)) {
    return {
      ok: false,
      reason: `client kind ${client.kind} not allowed for ${command.type}`,
    };
  }
  const requiredCapabilities = requiredCapabilitiesForCommand(command);
  const missing = requiredCapabilities.find(
    (capability) => !client.capabilities.includes(capability)
  );
  if (missing) {
    return {
      ok: false,
      reason: `missing capability: ${missing}`,
    };
  }
  return { ok: true };
}
