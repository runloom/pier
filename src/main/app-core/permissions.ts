import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClient,
} from "@shared/contracts/permissions.ts";

export type AuthorizationResult = { ok: true } | { ok: false; reason: string };

/**
 * 每条命令一行元数据:
 *   capabilities   —— 授权层要求的能力集 (authorizeCommand 校验)
 *   rendererFacade —— 是否允许通过通用 PIER.COMMAND_EXECUTE IPC 通道被
 *                     渲染进程直接调用 (src/main/ipc/command.ts 校验)
 *
 * 单一真源:加命令时 TypeScript 的 Record 全 key 类型强制两个字段必须一起填,
 * 避免 permissions 与 IPC 白名单漂移 (2026-07-03 事故:Plug-Task 2 加
 * worktree.creationDefaults/openTerminal 时白名单遗漏,面板打开即报
 * "unsupported renderer command")。
 *
 * rendererFacade=false 的命令并非 renderer 不可调用,而是有专用 IPC 通道
 * (如 preferences.read → "pier:preferences:read"),不通过通用通道。
 */
export interface CommandMetadata {
  readonly capabilities: readonly PierCapability[];
  readonly rendererFacade: boolean;
}

const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  "app.status": { capabilities: ["app:read"], rendererFacade: false },
  "commandPaletteMru.clear": {
    capabilities: ["app:read"],
    rendererFacade: false,
  },
  "commandPaletteMru.read": {
    capabilities: ["app:read"],
    rendererFacade: false,
  },
  "commandPaletteMru.record": {
    capabilities: ["app:read"],
    rendererFacade: false,
  },
  "panel.focus": { capabilities: ["panel:control"], rendererFacade: false },
  "panel.list": { capabilities: ["panel:read"], rendererFacade: false },
  "panel.open": { capabilities: ["workspace:open"], rendererFacade: false },
  "plugin.disable": { capabilities: ["plugin:write"], rendererFacade: true },
  "plugin.enable": { capabilities: ["plugin:write"], rendererFacade: true },
  "plugin.inspect": { capabilities: ["plugin:read"], rendererFacade: true },
  "plugin.list": { capabilities: ["plugin:read"], rendererFacade: true },
  "pluginSettings.getAll": {
    capabilities: ["plugin:read"],
    rendererFacade: true,
  },
  "pluginSettings.reset": {
    capabilities: ["plugin:write"],
    rendererFacade: true,
  },
  "pluginSettings.set": {
    capabilities: ["plugin:write"],
    rendererFacade: true,
  },
  "preferences.read": {
    capabilities: ["preferences:read"],
    rendererFacade: false,
  },
  "preferences.update": {
    capabilities: ["preferences:write"],
    rendererFacade: false,
  },
  "run.cancel": { capabilities: ["workspace:open"], rendererFacade: true },
  "run.list": { capabilities: ["workspace:read"], rendererFacade: true },
  "run.recent": { capabilities: ["workspace:read"], rendererFacade: false },
  "run.spawn": { capabilities: ["workspace:open"], rendererFacade: true },
  "run.status": { capabilities: ["workspace:read"], rendererFacade: true },
  // terminal.open 静态元数据只记基础 capabilities;launch 存在时的额外
  // 能力由 requiredCapabilitiesForCommand 动态叠加。
  "terminal.open": {
    capabilities: ["workspace:open"],
    rendererFacade: false,
  },
  "terminal.profile.delete": {
    capabilities: ["terminal:control"],
    rendererFacade: false,
  },
  "terminal.profile.list": {
    capabilities: ["terminal:read"],
    rendererFacade: false,
  },
  "terminal.profile.read": {
    capabilities: ["terminal:read"],
    rendererFacade: false,
  },
  "terminal.profile.upsert": {
    capabilities: ["terminal:control"],
    rendererFacade: false,
  },
  "terminalStatusBar.prefs.applyOverrides": {
    capabilities: ["preferences:write"],
    rendererFacade: false,
  },
  "terminalStatusBar.prefs.getAll": {
    capabilities: ["preferences:read"],
    rendererFacade: true,
  },
  "terminalStatusBar.prefs.resetItem": {
    capabilities: ["preferences:write"],
    rendererFacade: true,
  },
  "terminalStatusBar.prefs.setItemOverride": {
    capabilities: ["preferences:write"],
    rendererFacade: true,
  },
  "window.close": { capabilities: ["window:close"], rendererFacade: false },
  "window.create": { capabilities: ["window:create"], rendererFacade: false },
  "window.focus": { capabilities: ["window:focus"], rendererFacade: false },
  "window.list": { capabilities: ["window:read"], rendererFacade: false },
  "worktree.check": { capabilities: ["worktree:read"], rendererFacade: true },
  "worktree.create": {
    capabilities: ["worktree:write"],
    rendererFacade: true,
  },
  "worktree.creationDefaults": {
    capabilities: ["worktree:read"],
    rendererFacade: true,
  },
  "worktree.list": { capabilities: ["worktree:read"], rendererFacade: true },
  "worktree.open": {
    capabilities: ["worktree:read", "workspace:open"],
    rendererFacade: true,
  },
  "worktree.openTerminal": {
    capabilities: ["worktree:write"],
    rendererFacade: true,
  },
  "worktree.prune": {
    capabilities: ["worktree:write"],
    rendererFacade: true,
  },
  "worktree.remove": {
    capabilities: ["worktree:write"],
    rendererFacade: true,
  },
  "workspace.layout.clear": {
    capabilities: ["workspace:write"],
    rendererFacade: false,
  },
  "workspace.layout.read": {
    capabilities: ["workspace:read"],
    rendererFacade: false,
  },
  "workspace.layout.save": {
    capabilities: ["workspace:write"],
    rendererFacade: false,
  },
  "file.list": { capabilities: ["file:read"], rendererFacade: true },
  "file.move": { capabilities: ["file:write"], rendererFacade: true },
  "file.readText": { capabilities: ["file:read"], rendererFacade: true },
  "file.rename": { capabilities: ["file:write"], rendererFacade: true },
  "file.trash": { capabilities: ["file:write"], rendererFacade: true },
  "file.writeText": { capabilities: ["file:write"], rendererFacade: true },
  // Git 读写分开授权:读命令 git:read, 写命令 git:write。
  "git.checkoutBranch": {
    capabilities: ["git:write"],
    rendererFacade: true,
  },
  "git.commit": { capabilities: ["git:write"], rendererFacade: true },
  "git.createBranch": { capabilities: ["git:write"], rendererFacade: true },
  "git.deleteBranch": { capabilities: ["git:write"], rendererFacade: true },
  "git.discardChanges": {
    capabilities: ["git:write"],
    rendererFacade: true,
  },
  "git.getCommit": { capabilities: ["git:read"], rendererFacade: true },
  "git.getCommitPatch": { capabilities: ["git:read"], rendererFacade: true },
  "git.getDiffPatch": { capabilities: ["git:read"], rendererFacade: true },
  "git.getDiffSummary": {
    capabilities: ["git:read"],
    rendererFacade: true,
  },
  "git.getDiffText": { capabilities: ["git:read"], rendererFacade: true },
  "git.getFileContent": {
    capabilities: ["git:read"],
    rendererFacade: true,
  },
  "git.getLog": { capabilities: ["git:read"], rendererFacade: true },
  "git.getRepoInfo": { capabilities: ["git:read"], rendererFacade: true },
  "git.getStatus": { capabilities: ["git:read"], rendererFacade: true },
  "git.isWorkingTreeClean": {
    capabilities: ["git:read"],
    rendererFacade: true,
  },
  "git.listBranches": { capabilities: ["git:read"], rendererFacade: true },
  "git.listTags": { capabilities: ["git:read"], rendererFacade: true },
  "git.merge": { capabilities: ["git:write"], rendererFacade: true },
  "git.mergeAbort": { capabilities: ["git:write"], rendererFacade: true },
  "git.rebase": { capabilities: ["git:write"], rendererFacade: true },
  "git.rebaseAbort": { capabilities: ["git:write"], rendererFacade: true },
  "git.rebaseContinue": {
    capabilities: ["git:write"],
    rendererFacade: true,
  },
  "git.resolveRef": { capabilities: ["git:read"], rendererFacade: true },
  "git.searchBranches": { capabilities: ["git:read"], rendererFacade: true },
  "git.stage": { capabilities: ["git:write"], rendererFacade: true },
  "git.stash": { capabilities: ["git:write"], rendererFacade: true },
  "git.stashList": { capabilities: ["git:read"], rendererFacade: true },
  "git.stashPop": { capabilities: ["git:write"], rendererFacade: true },
  "git.undoLastCommit": {
    capabilities: ["git:write"],
    rendererFacade: true,
  },
  "git.unstage": { capabilities: ["git:write"], rendererFacade: true },
  "git.validateBranchName": {
    capabilities: ["git:read"],
    rendererFacade: true,
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

export function commandAllowsRendererFacade(
  type: PierCommand["type"]
): boolean {
  return COMMAND_METADATA[type].rendererFacade;
}
