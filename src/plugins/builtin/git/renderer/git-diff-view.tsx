import type {
  GitDiffHunk,
  GitDiffLine,
  GitDiffPatch,
} from "@shared/contracts/git.ts";

/** 纯展示组件不碰 i18n:文案由面板层解析后传入,保持本组件可独立测试。 */
export interface GitDiffViewText {
  binaryFile: string;
  noChanges: string;
}

interface GitDiffViewProps {
  patch: GitDiffPatch;
  /** 选中文件的当前路径(重命名场景为新路径)。 */
  path: string;
  text: GitDiffViewText;
}

interface GitDiffRow {
  key: string;
  kind: GitDiffLine["kind"];
  text: string;
}

const LINE_PREFIX: Record<GitDiffLine["kind"], string> = {
  add: "+",
  context: " ",
  del: "-",
};

// 颜色沿用主题 success/destructive token(与 git-status-parts 的 +/− 统计一致),
// 不引 emerald 等裸色阶,保证亮暗主题同步。
const LINE_CLASS: Record<GitDiffLine["kind"], string> = {
  add: "bg-success/10 text-success",
  context: "text-foreground",
  del: "bg-destructive/10 text-destructive",
};

/**
 * 逐行推进新旧行号来构造 key:同一 hunk 内 (kind, oldLine, newLine) 组合唯一,
 * 避免数组下标 key 在列表变化时错配 DOM。
 */
function hunkRows(hunk: GitDiffHunk): GitDiffRow[] {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.lines.map((line) => {
    const row: GitDiffRow = {
      key: `${line.kind}-${oldLine}-${newLine}`,
      kind: line.kind,
      text: line.text,
    };
    if (line.kind !== "add") {
      oldLine += 1;
    }
    if (line.kind !== "del") {
      newLine += 1;
    }
    return row;
  });
}

export function GitDiffView({ patch, path, text }: GitDiffViewProps) {
  // 重命名/复制时状态行的 path 是新路径,但 patch 可能以旧路径命中,两边都查。
  const filePatch = patch.files.find(
    (file) => file.path === path || file.oldPath === path
  );
  // 无 diff(如未跟踪文件)或空 hunks 都视为"无可展示的变更"。
  if (!filePatch || (!filePatch.binary && filePatch.hunks.length === 0)) {
    return <p className="text-muted-foreground text-sm">{text.noChanges}</p>;
  }
  if (filePatch.binary) {
    return <p className="text-muted-foreground text-sm">{text.binaryFile}</p>;
  }
  return (
    <div
      className="flex min-w-fit flex-col font-mono text-xs"
      data-testid="git-diff-view"
    >
      <div
        className="mb-2 font-medium text-foreground"
        data-testid="git-diff-file-header"
      >
        {filePatch.oldPath != null && filePatch.oldPath !== filePatch.path
          ? `${filePatch.oldPath} → ${filePatch.path}`
          : filePatch.path}
      </div>
      {filePatch.hunks.map((hunk) => (
        <div className="mb-2" key={`${hunk.oldStart}-${hunk.newStart}`}>
          <div className="whitespace-pre bg-muted px-2 py-0.5 text-muted-foreground">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </div>
          {hunkRows(hunk).map((row) => (
            <div
              className={`whitespace-pre px-2 ${LINE_CLASS[row.kind]}`}
              data-diff-line={row.kind}
              key={row.key}
            >
              {LINE_PREFIX[row.kind]}
              {row.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
