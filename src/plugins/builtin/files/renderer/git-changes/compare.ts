import {
  type FileDiffMetadata,
  type Hunk,
  parseDiffFromFile,
} from "@pier/ui/diff-view/file-diff/from-contents.ts";
import type { GitGutterLineMarker } from "../editor/git-markers.ts";
import {
  type CompareRequest,
  EMPTY_FILE_CHANGES,
  type FileChangeRange,
  type FileChanges,
} from "./types.ts";

/** Runs in the comparison Worker. Pierre owns the diff algorithm and line splitting. */
export function compareFileContents(input: CompareRequest): FileChanges {
  if (input.before === input.after) return EMPTY_FILE_CHANGES;
  const diff = parseDiffFromFile(
    { name: input.path, contents: input.before },
    { name: input.path, contents: input.after },
    { context: 3 },
    true
  );
  const ranges: FileChangeRange[] = [];
  const cacheIdentity = crypto.randomUUID();
  const markers = new Map<number, GitGutterLineMarker>();
  // CodeMirror keeps an empty final line after a trailing newline.
  const maxLine =
    diff.additionLines.length + (input.after.endsWith("\n") ? 1 : 0) || 1;
  for (const hunk of diff.hunks) {
    for (const [index, part] of hunk.hunkContent.entries()) {
      if (part.type !== "change") continue;
      const previous = hunk.hunkContent[index - 1];
      const next = hunk.hunkContent[index + 1];
      const before =
        previous?.type === "context" ? Math.min(3, previous.lines) : 0;
      const after = next?.type === "context" ? Math.min(3, next.lines) : 0;
      const id = `${input.version}:${ranges.length}`;
      let kind: FileChangeRange["kind"] = "modified";
      if (part.deletions === 0) kind = "added";
      else if (part.additions === 0) kind = "deleted";
      const additionIndex = Math.max(0, part.additionLineIndex);
      const deletionIndex = Math.max(0, part.deletionLineIndex);
      const newLineFrom = Math.min(maxLine, additionIndex + 1);
      const newLineTo = Math.min(
        maxLine,
        newLineFrom + Math.max(1, part.additions) - 1
      );
      const oldIndex = deletionIndex - before;
      const newIndex = additionIndex - before;
      const deletions = diff.deletionLines.slice(
        oldIndex,
        deletionIndex + part.deletions + after
      );
      const additions = diff.additionLines.slice(
        newIndex,
        additionIndex + part.additions + after
      );
      const content: Hunk["hunkContent"] = [];
      if (before)
        content.push({
          type: "context",
          lines: before,
          additionLineIndex: 0,
          deletionLineIndex: 0,
        });
      content.push({
        ...part,
        additionLineIndex: before,
        deletionLineIndex: before,
      });
      if (after)
        content.push({
          type: "context",
          lines: after,
          additionLineIndex: before + part.additions,
          deletionLineIndex: before + part.deletions,
        });
      const unifiedLineCount = before + part.deletions + part.additions + after;
      const splitLineCount =
        before + Math.max(part.deletions, part.additions) + after;
      const excerpt: FileDiffMetadata = {
        name: input.path,
        type: diff.type,
        isPartial: true,
        cacheKey: `files-peek:${cacheIdentity}:${id}:${input.path}`,
        additionLines: additions,
        deletionLines: deletions,
        unifiedLineCount,
        splitLineCount,
        hunks: [
          {
            ...hunk,
            hunkSpecs: `@@ -${deletions.length ? oldIndex + 1 : oldIndex},${deletions.length} +${additions.length ? newIndex + 1 : newIndex},${additions.length} @@`,
            additionStart: additions.length ? newIndex + 1 : newIndex,
            deletionStart: deletions.length ? oldIndex + 1 : oldIndex,
            additionCount: additions.length,
            deletionCount: deletions.length,
            additionLineIndex: 0,
            deletionLineIndex: 0,
            additionLines: part.additions,
            deletionLines: part.deletions,
            hunkContent: content,
            collapsedBefore: 0,
            unifiedLineStart: 0,
            splitLineStart: 0,
            unifiedLineCount,
            splitLineCount,
            noEOFCRAdditions:
              hunk.noEOFCRAdditions &&
              newIndex + additions.length === diff.additionLines.length,
            noEOFCRDeletions:
              hunk.noEOFCRDeletions &&
              oldIndex + deletions.length === diff.deletionLines.length,
          },
        ],
      };
      ranges.push({
        id,
        kind,
        newLineFrom,
        newLineTo,
        oldLineFrom: deletionIndex + 1,
        oldLineCount: part.deletions,
        newLineCount: part.additions,
        excerpt,
      });
      for (let line = newLineFrom; line <= newLineTo; line++) {
        const current = markers.get(line);
        markers.set(line, {
          kind: current ? "modified" : kind,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
  }
  return { markers, ranges };
}
