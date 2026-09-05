import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FileChangeRange, FileChangesSnapshot } from "./types.ts";

/** Never reuse buffer coordinates for a different saved/index document. */
export async function openSavedFileChanges(input: {
  context: RendererPluginContext;
  panelContext: PanelContext;
  root: string;
  path: string;
  snapshot: FileChangesSnapshot;
  range: FileChangeRange | undefined;
}): Promise<"opened" | "save-first" | "unavailable"> {
  const { context, snapshot, range } = input;
  const source = {
    contextId: input.panelContext.contextId,
    gitRootPath: input.root,
    path: input.path,
    oldPaths: [],
    target: { kind: "uncommitted" as const },
  };
  const index = await context.git.getReviewIndex({
    source: {
      contextId: source.contextId,
      gitRootPath: source.gitRootPath,
      target: source.target,
    },
    operationId: crypto.randomUUID(),
  });
  if (index.kind !== "ok") throw new Error(index.message ?? index.reason);
  const entry = index.entries.find((item) => item.path === input.path);
  if (!entry) return snapshot.dirty ? "save-first" : "unavailable";
  const document = await context.git.getReviewFileDocument({
    source: { ...source, oldPaths: entry.oldPaths },
    operationId: crypto.randomUUID(),
  });
  if (document.kind !== "ok")
    throw new Error(
      document.kind === "error"
        ? (document.message ?? document.reason)
        : "review-unavailable"
    );
  const slots = entry.renderSlots;
  // Only claim precision when the actual selected review section has both identical sides.
  const exact =
    !snapshot.dirty && range
      ? slots.find((slot) => {
          const section = document.sections.find(
            (item) => item.sectionKey === slot.sectionKey
          );
          return (
            section?.kind === "patch" &&
            section.oldContents === snapshot.baseline &&
            section.newContents === snapshot.contents
          );
        })
      : undefined;
  const slot = exact ?? slots[0];
  if (!slot) return "unavailable";
  const section = document.sections.find(
    (item) => item.sectionKey === slot.sectionKey
  );
  const first = section?.kind === "patch" ? section.changeBlocks[0] : undefined;
  const deleted = exact
    ? range?.newLineCount === 0
    : first?.workingRange.count === 0;
  const side = deleted ? "old" : "new";
  let line = Math.max(
    1,
    deleted ? (first?.headRange.start ?? 1) : (first?.workingRange.start ?? 1)
  );
  if (exact && range) line = deleted ? range.oldLineFrom : range.newLineFrom;
  return context.git.openUncommittedChanges({
    panelContext: {
      ...input.panelContext,
      gitRoot: input.root,
      worktreeRoot: input.root,
    },
    pendingReveal: {
      path: input.path,
      line,
      side,
      group: slot.group,
      allowGroupFallback: true,
    },
  })
    ? "opened"
    : "unavailable";
}
