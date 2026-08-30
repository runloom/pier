import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewTarget } from "@shared/contracts/git/review.ts";

/** 走插件 i18n 拿 `ui.*` 命名空间下的翻译。key 未定义时返回 fallback。 */
export function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>,
  locale?: string
): string {
  return context.i18n.t(`ui.${key}`, values, fallback, locale);
}

/**
 * Shared factory for git review file/dir collision labels.
 * Tree, CodeView, demand, and comment nav must use the same function so
 * displayPath natural sort stays aligned under every locale.
 */
export function createReviewCollidingFileLabel(
  context: RendererPluginContext,
  language?: string
): (name: string) => string {
  return (name: string) =>
    pluginText(
      context,
      "reviewFilePathCollision",
      "File change · {{name}}",
      language === undefined ? { name } : { language, name },
      language
    );
}

export function gitReviewEmptyDescription(
  context: RendererPluginContext,
  target: GitReviewTarget
): string {
  if (target.kind === "commit") {
    if (target.fromOid !== undefined && target.fromOid !== target.oid) {
      return pluginText(
        context,
        "reviewEmptyDescriptionCommitRange",
        "The selected commits have no file changes."
      );
    }
    return pluginText(
      context,
      "reviewEmptyDescriptionCommit",
      "The selected commit has no file changes."
    );
  }
  if (target.kind === "branch") {
    return pluginText(
      context,
      "reviewEmptyDescriptionBranch",
      "The current branch has no changes relative to {{branch}}.",
      { branch: target.ref }
    );
  }
  return pluginText(
    context,
    "reviewEmptyDescription",
    "The working tree has no staged or unstaged changes."
  );
}
