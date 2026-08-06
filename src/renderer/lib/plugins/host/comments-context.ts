import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

/**
 * 评论能力门面实现(对齐 createPluginGitContext):capability 断言与 main 侧
 * COMMAND_METADATA 严格一致——读路径 comments:read,写路径 comments:read +
 * comments:write。透传 window.pier.comments.*。
 *
 * v1 瘦身:只暴露 snapshot / watch / listProjects / createThread /
 * updateComment / deleteComment。
 */
export function createPluginCommentsContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["comments"] {
  return {
    createThread: (request) => {
      assertPluginCapability(entry, "comments:read");
      assertPluginCapability(entry, "comments:write");
      return window.pier.comments.createThread(request);
    },
    deleteComment: (request) => {
      assertPluginCapability(entry, "comments:read");
      assertPluginCapability(entry, "comments:write");
      return window.pier.comments.deleteComment(request);
    },
    listProjects: (request) => {
      assertPluginCapability(entry, "comments:read");
      return window.pier.comments.listProjects(request);
    },
    snapshot: async (worktreeKey) => {
      assertPluginCapability(entry, "comments:read");
      const result = await window.pier.comments.list({ worktreeKey });
      return result.kind === "ok" ? result.snapshot : null;
    },
    updateComment: (request) => {
      assertPluginCapability(entry, "comments:read");
      assertPluginCapability(entry, "comments:write");
      return window.pier.comments.updateComment(request);
    },
    watch: (worktreeKey, listener) => {
      assertPluginCapability(entry, "comments:read");
      return window.pier.comments.onChanged((snapshot) => {
        if (snapshot.worktreeKey === worktreeKey) {
          listener(snapshot);
        }
      });
    },
  };
}
