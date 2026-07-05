import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

/**
 * worktrees namespace 适配器:capability 断言后透传 preload facade。
 * capability 映射与 main 侧 app-core/permissions.ts 的命令表保持一致
 * (check/list/creationDefaults=read;create/remove/prune/openTerminal=write;
 * open=read+workspace:open)。
 */
export function createPluginWorktreesContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["worktrees"] {
  return {
    check: (request) => {
      assertPluginCapability(entry, "worktree:read");
      return window.pier.worktrees.check(request);
    },
    create: (request) => {
      assertPluginCapability(entry, "worktree:write");
      return window.pier.worktrees.create(request);
    },
    creationDefaults: (request) => {
      assertPluginCapability(entry, "worktree:read");
      return window.pier.worktrees.creationDefaults(request);
    },
    list: (request) => {
      assertPluginCapability(entry, "worktree:read");
      return window.pier.worktrees.list(request);
    },
    open: (request) => {
      assertPluginCapability(entry, "worktree:read");
      assertPluginCapability(entry, "workspace:open");
      return window.pier.worktrees.open(request);
    },
    openTerminal: (request) => {
      assertPluginCapability(entry, "worktree:write");
      return window.pier.worktrees.openTerminal(request);
    },
    prune: (request) => {
      assertPluginCapability(entry, "worktree:write");
      return window.pier.worktrees.prune(request);
    },
    remove: (request) => {
      assertPluginCapability(entry, "worktree:write");
      return window.pier.worktrees.remove(request);
    },
  };
}
