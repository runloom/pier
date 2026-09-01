/**
 * 单栏 unified diff：add/del/context 等宽着色；大 hunk 截断。
 */
import type {
  GitDiffFilePatch,
  GitDiffHunk,
  GitDiffLine,
} from "@shared/contracts/git.ts";

export const DIFF_HUNK_LINE_LIMIT = 200;

function hunkHeader(hunk: GitDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

function lineClass(kind: "add" | "context" | "del"): string {
  if (kind === "add") {
    return "bg-emerald-950/60 text-emerald-300";
  }
  if (kind === "del") {
    return "bg-red-950/60 text-red-300";
  }
  return "text-neutral-400";
}

function linePrefix(kind: "add" | "context" | "del"): string {
  if (kind === "add") {
    return "+";
  }
  if (kind === "del") {
    return "-";
  }
  return " ";
}

export function hunkLineDelta(hunks: GitDiffHunk[]): {
  deletions: number;
  insertions: number;
} {
  let deletions = 0;
  let insertions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        insertions += 1;
      } else if (line.kind === "del") {
        deletions += 1;
      }
    }
  }
  return { deletions, insertions };
}

function numberedDiffLines(
  hunk: GitDiffHunk,
  lines: GitDiffLine[]
): Array<{ key: string; line: GitDiffLine }> {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return lines.map((line) => {
    const key = `${line.kind}:${oldLine}:${newLine}:${line.text}`;
    if (line.kind !== "add") {
      oldLine += 1;
    }
    if (line.kind !== "del") {
      newLine += 1;
    }
    return { key, line };
  });
}

function HunkView(props: { hunk: GitDiffHunk }) {
  const truncated = props.hunk.lines.length > DIFF_HUNK_LINE_LIMIT;
  const lines = truncated
    ? props.hunk.lines.slice(0, DIFF_HUNK_LINE_LIMIT)
    : props.hunk.lines;
  const numbered = numberedDiffLines(props.hunk, lines);
  return (
    <div className="mt-2" data-testid="git-hunk">
      <p className="font-mono text-[10px] text-neutral-500">
        {hunkHeader(props.hunk)}
      </p>
      <pre className="overflow-x-auto font-mono text-[10px] leading-5">
        {numbered.map((entry) => (
          <div
            className={lineClass(entry.line.kind)}
            data-testid={`diff-line-${entry.line.kind}`}
            key={entry.key}
          >
            {linePrefix(entry.line.kind)}
            {entry.line.text}
          </div>
        ))}
      </pre>
      {truncated && (
        <p
          className="mt-1 text-[10px] text-amber-400"
          data-testid="diff-truncated"
        >
          已截断（超过 {DIFF_HUNK_LINE_LIMIT} 行）
        </p>
      )}
    </div>
  );
}

export function UnifiedDiff(props: { files: GitDiffFilePatch[] }) {
  return (
    <section data-testid="git-diff">
      {props.files.map((file) => (
        <div
          className="mb-3 rounded border border-neutral-800 bg-neutral-900/60 p-2"
          data-testid="git-patch-file"
          key={file.path}
        >
          <p className="font-mono text-[11px] text-neutral-200">
            {file.path}
            {file.binary && " · binary"}
          </p>
          {!file.binary &&
            file.hunks.map((hunk) => (
              <HunkView
                hunk={hunk}
                key={`${file.path}:${hunk.oldStart}:${hunk.newStart}`}
              />
            ))}
        </div>
      ))}
    </section>
  );
}
