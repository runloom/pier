import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

export function createPluginGitContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["git"] {
  return {
    abortMerge: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.abortMerge(cwd);
    },
    abortRebase: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.abortRebase(cwd);
    },
    checkoutBranch: (cwd, name) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.checkoutBranch(cwd, name);
    },
    continueRebase: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.continueRebase(cwd);
    },
    discardChanges: (cwd, paths) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.discardChanges(cwd, paths);
    },
    getDiffPatch: (cwd, options) => {
      assertPluginCapability(entry, "git:read");
      const { path, ...gitOptions } = options ?? {};
      return window.pier.git.getDiffPatch(cwd, {
        ...gitOptions,
        ...(path ? { paths: [path] } : {}),
      });
    },
    getFileContent: (cwd, options) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.getFileContent(cwd, options);
    },
    getRepoInfo: (cwd) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.getRepoInfo(cwd);
    },
    getStatus: (cwd) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.getStatus(cwd);
    },
    listBranches: (cwd, options) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.listBranches(cwd, options);
    },
    listStashes: (cwd) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.listStashes(cwd);
    },
    merge: (cwd, branch) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.merge(cwd, branch);
    },
    popStash: (cwd, index) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.popStash(cwd, index);
    },
    pullFastForward: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.pullFastForward(cwd);
    },
    push: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.push(cwd);
    },
    applyStash: (cwd, index) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.applyStash(cwd, index);
    },
    dropStash: (cwd, index) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.dropStash(cwd, index);
    },
    rebase: (cwd, branch) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.rebase(cwd, branch);
    },
    searchBranches: (cwd, options) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.searchBranches(cwd, options);
    },
    stage: (cwd, paths) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.stage(cwd, paths);
    },
    stash: (cwd, options) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.stash(cwd, options);
    },
    sync: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.sync(cwd);
    },
    undoLastCommit: (cwd) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.undoLastCommit(cwd);
    },
    unstage: (cwd, paths) => {
      assertPluginCapability(entry, "git:write");
      return window.pier.git.unstage(cwd, paths);
    },
    watch: (gitRoot, listener) => {
      assertPluginCapability(entry, "git:read");
      return window.pier.git.watch(gitRoot, listener);
    },
  };
}
