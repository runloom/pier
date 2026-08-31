import type { PierCommand } from "@shared/contracts/commands.ts";
import type {
  PierCapability,
  PierClientKind,
} from "@shared/contracts/permissions.ts";
import { ASSET_COMMAND_METADATA } from "./asset-metadata.ts";
import { MOBILE_COMMAND_METADATA } from "./mobile-command-metadata.ts";

/** Exhaustive per-command authorization; Record keys cover every PierCommand type. */
export interface CommandMetadata {
  readonly allowedClientKinds?: readonly PierClientKind[];
  /** 沙箱轨主体可调用？缺省 false（deny-by-default，Phase 2）。 */
  readonly allowPluginPrincipals?: boolean;
  readonly capabilities: readonly PierCapability[];
}

export const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  ...ASSET_COMMAND_METADATA,
  "ai.status": { capabilities: ["ai:invoke"] },
  "ai.generateText": { capabilities: ["ai:invoke"] },
  "environment.project.add": { capabilities: ["environment:write"] },
  "environment.project.remove": { capabilities: ["environment:write"] },
  "environment.snapshot": { capabilities: ["environment:read"] },
  "environment.update": { capabilities: ["environment:write"] },
  "environment.worktreeBinding": { capabilities: ["environment:read"] },
  "pierHome.info": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read"],
  },
  "pierHome.reveal": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "pierHome.skills.list": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "pierHome.skills.snapshot": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "pierHome.skills.create": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "pierHome.skills.read": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "pierHome.skills.write": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "pierHome.skills.delete": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "pierHome.skills.setAlwaysInclude": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "pierHome.skills.reveal": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "skills.pierBindings.list": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "skills.pierBindings.bind": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "skills.pierBindings.unbind": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "liveModules.registerRoot": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "liveModules.unregisterRoot": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:write"],
  },
  "liveModules.compile": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "liveModules.getUrl": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["file:read"],
  },
  "liveModules.trustStatus": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["preferences:read"],
  },
  "liveModules.grantTrust": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["preferences:write"],
  },
  "liveModules.revokeTrust": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["preferences:write"],
  },
  "app.status": { capabilities: ["app:read"] },
  "app.cli.status": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read"],
  },
  "app.cli.install": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read"],
  },
  "app.cli.uninstall": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["app:read"],
  },
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
  "panel.setSize": { capabilities: ["panel:control"] },
  "panel.equalize": { capabilities: ["panel:control"] },
  "plugin.disable": { capabilities: ["plugin:write"] },
  "plugin.enable": { capabilities: ["plugin:write"] },
  "plugin.inspect": { capabilities: ["plugin:read"] },
  "plugin.list": { capabilities: ["plugin:read"] },
  "plugin.workspace.plan": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["plugin:read"],
  },
  "pluginSettings.getAll": { capabilities: ["plugin:read"] },
  "pluginData.snapshot": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:read"],
  },
  "pluginData.watchStart": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:read"],
  },
  "pluginData.watchStop": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:read"],
  },
  "pluginAction.invoke": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:action"],
  },
  "canvasCommand.invoke": {
    allowedClientKinds: ["canvas"],
    capabilities: ["canvas:command"],
  },
  "settings.open": {
    allowedClientKinds: ["canvas"],
    capabilities: ["preferences:read"],
  },
  "usageData.refresh": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:read"],
  },
  "pluginSettings.reset": { capabilities: ["plugin:write"] },
  "pluginSettings.set": { capabilities: ["plugin:write"] },
  "preferences.read": { capabilities: ["preferences:read"] },
  "preferences.update": { capabilities: ["preferences:write"] },
  "shellEnvironment.status": { capabilities: ["preferences:read"] },
  "shellEnvironment.refresh": { capabilities: ["preferences:write"] },
  "run.cancel": { capabilities: ["workspace:open"] },
  "run.backgroundSnapshot": { capabilities: ["workspace:read"] },
  "run.runsSnapshot": { capabilities: ["workspace:read"] },
  "run.list": { capabilities: ["workspace:read"] },
  "run.output": { capabilities: ["workspace:read"] },
  "run.recent": { capabilities: ["workspace:read"] },
  "run.rerun": { capabilities: ["workspace:open"] },
  "run.spawn": { capabilities: ["workspace:open"] },
  "run.status": { capabilities: ["workspace:read"] },
  "run.stop": { capabilities: ["workspace:open"] },
  "app.snapshot": { capabilities: ["app:read"] },
  "notifications.list": { capabilities: ["notification:read"] },
  "notifications.get": { capabilities: ["notification:read"] },
  "notifications.watch": { capabilities: ["notification:read"] },
  "notifications.focus": { capabilities: ["notification:write"] },
  "notifications.mark-read": { capabilities: ["notification:write"] },
  ...MOBILE_COMMAND_METADATA,
  // terminal.open 静态只记基础能力；launch 额外能力由 requiredCapabilitiesForCommand 叠加。
  "terminal.open": { capabilities: ["workspace:open"] },
  "terminal.list": { capabilities: ["terminal:read"] },
  "terminal.get": { capabilities: ["terminal:read"] },
  "terminal.send": { capabilities: ["terminal:control"] },
  "terminal.key": { capabilities: ["terminal:control"] },
  "terminal.screen": { capabilities: ["terminal:read"] },
  "terminal.read": { capabilities: ["terminal:read"] },
  "terminal.close": { capabilities: ["terminal:control"] },
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
  "worktree.get": { capabilities: ["worktree:read"] },
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
  "file.openPath": { capabilities: ["file:read"] },
  "file.reveal": { capabilities: ["file:read"] },
  "file.drafts.listKeys": { capabilities: ["file:read"] },
  "file.drafts.listDiagnostics": { capabilities: ["file:read"] },
  "file.drafts.get": { capabilities: ["file:read"] },
  "file.drafts.set": { capabilities: ["file:write"] },
  "file.drafts.delete": { capabilities: ["file:write"] },
  "file.drafts.claimLegacy": { capabilities: ["file:write"] },
  // Git 读写分开授权:读命令 git:read, 写命令 git:write。
  "git.checkoutBranch": { capabilities: ["git:write"] },
  "git.cherryPick": { capabilities: ["git:write"] },
  "git.cherryPickAbort": { capabilities: ["git:write"] },
  "git.cherryPickContinue": { capabilities: ["git:write"] },
  "git.commit": { capabilities: ["git:write"] },
  "git.createAndSwitchBranch": { capabilities: ["git:write"] },
  "git.createBranch": { capabilities: ["git:write"] },
  "git.deleteBranch": { capabilities: ["git:write"] },
  "git.discardChanges": { capabilities: ["git:write"] },
  "git.getDiffPatch": { capabilities: ["git:read"] },
  "git.getStatus": { capabilities: ["git:read"] },
  // S2 同步开面板：桌面 + 配对移动端；打开面板与 panel.open/terminal.open
  // 同用 workspace:open（panel:open 是插件 manifest 权限，不是客户端能力）。
  "git.openReviewPanel": {
    allowedClientKinds: ["desktop-renderer", "mobile-paired"],
    capabilities: ["git:read", "workspace:open"],
  },
  "git.getReviewIndex": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.getReviewFileDocument": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.getReviewExcerptBatch": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.cancelReviewRequest": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read"],
  },
  "git.applyReviewMutation": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read", "git:write"],
  },
  "git.applyReviewPathMutation": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read", "git:write"],
  },
  "git.resolveReviewConflict": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["git:read", "git:write"],
  },
  "git.listIgnored": { capabilities: ["git:read"] },
  "git.listBranches": { capabilities: ["git:read"] },
  "git.merge": { capabilities: ["git:write"] },
  "git.mergeAbort": { capabilities: ["git:write"] },
  "git.fetch": { capabilities: ["git:write"] },
  "git.pullFastForward": { capabilities: ["git:write"] },
  "git.publish": { capabilities: ["git:write"] },
  "git.push": { capabilities: ["git:write"] },
  "git.rebase": { capabilities: ["git:write"] },
  "git.rebaseAbort": { capabilities: ["git:write"] },
  "git.rebaseContinue": { capabilities: ["git:write"] },
  "git.revert": { capabilities: ["git:write"] },
  "git.revertAbort": { capabilities: ["git:write"] },
  "git.revertContinue": { capabilities: ["git:write"] },
  "git.searchBranches": { capabilities: ["git:read"] },
  "git.searchCommits": { capabilities: ["git:read"] },
  "git.stage": { capabilities: ["git:write"] },
  "git.stash": { capabilities: ["git:write"] },
  "git.stashApply": { capabilities: ["git:write"] },
  "git.stashDrop": { capabilities: ["git:write"] },
  "git.stashList": { capabilities: ["git:read"] },
  "git.stashPop": { capabilities: ["git:write"] },
  "git.sync": { capabilities: ["git:write"] },
  "git.undoLastCommit": { capabilities: ["git:write"] },
  "git.unstage": { capabilities: ["git:write"] },
  "comments.list": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["comments:read"],
  },
  "comments.listProjects": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["comments:read"],
  },
  "comments.createThread": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["comments:read", "comments:write"],
  },
  "comments.updateComment": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["comments:read", "comments:write"],
  },
  "comments.deleteComment": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["comments:read", "comments:write"],
  },
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
  "skills.projects.snapshot": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:read"],
  },
  "skills.snapshot": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["skills:read"],
  },
  // Read one discovered skill's SKILL.md (read-only detail / editor prefill).
  "skills.skill.read": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["skills:read"],
  },
  "skills.import.prepare": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.import.prepareFromDiscovery": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.import.prepareTemplate": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.import.prepareContentUpdate": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.import.discard": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.plan": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:read"],
  },
  "skills.apply": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.repair.plan": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:read"],
  },
  "skills.repair": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["skills:write"],
  },
  "skills.doctor": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["skills:read"],
  },
  "skills.operation.status": {
    allowedClientKinds: ["desktop-renderer", "cli-local"],
    capabilities: ["skills:read"],
  },
  "agent.launch.continue": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["workspace:open", "terminal:control"],
  },
  "app.relaunch": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.offer": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.drop": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.finishDrag": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.cancel": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.bootstrap": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.ready": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
  "panelTransfer.relocate": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["window:control"],
  },
};
