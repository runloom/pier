/**
 * S2 变更页（只读）：git.getStatus + git.getDiffPatch 投影当前工作树。
 * cwd 取快照首个 worktree 路径；不提供任何写操作。
 */
import type {
  GitDiffHunk,
  GitDiffPatch,
  GitStatus,
} from "@shared/contracts/git.ts";
import { gitDiffPatchSchema, gitStatusSchema } from "@shared/contracts/git.ts";
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { getMobileClient } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

export function pickWorktreeCwd(
  snapshot: ControlSnapshotPayload | null
): string | null {
  if (snapshot === null) {
    return null;
  }
  return (
    snapshot.worktrees.find((entry) => entry.path !== undefined)?.path ??
    snapshot.agents.find((entry) => entry.cwd !== undefined)?.cwd ??
    null
  );
}

function hunkHeader(hunk: GitDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function ChangesPage() {
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const cwd = pickWorktreeCwd(snapshot);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [patch, setPatch] = useState<GitDiffPatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cwd === null) {
      return;
    }
    let alive = true;
    const client = getMobileClient();
    client
      .command({ cwd, type: "git.getStatus" })
      .then((raw) => {
        const parsed = gitStatusSchema.parse(raw);
        if (alive) {
          setStatus(parsed);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : "读取状态失败");
        }
      });
    client
      .command({ cwd, type: "git.getDiffPatch" })
      .then((raw) => {
        const parsed = gitDiffPatchSchema.parse(raw);
        if (alive) {
          setPatch(parsed);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cwd]);

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title="变更 · 只读" />
      <main className="flex-1 px-4 py-4">
        <p
          className="mb-3 text-[10px] text-neutral-500"
          data-testid="changes-cwd"
        >
          {cwd ?? "无法确定工作树目录"}
        </p>
        {error !== null && (
          <p className="mb-3 text-red-400 text-xs" role="alert">
            {error}
          </p>
        )}
        {status === null ? (
          <p className="text-neutral-500 text-sm">读取中…</p>
        ) : (
          <>
            <section className="mb-4" data-testid="git-status">
              <p className="text-neutral-300 text-sm">
                {status.branch.branch ?? "detached HEAD"}
                {status.branch.ahead > 0 && ` ↑${status.branch.ahead}`}
                {status.branch.behind > 0 && ` ↓${status.branch.behind}`}
              </p>
              <p className="mt-0.5 text-neutral-500 text-xs">
                修改 {status.counts.modified} · 暂存 {status.counts.staged} ·
                未跟踪 {status.counts.untracked} · 冲突 {status.counts.conflict}
              </p>
            </section>
            <section className="mb-4">
              <h2 className="mb-2 text-neutral-400 text-xs">文件</h2>
              <ul className="flex flex-col gap-1">
                {status.files.map((file) => (
                  <li
                    className="flex items-center justify-between font-mono text-[11px]"
                    data-testid="git-file"
                    key={`${file.path}:${file.worktree}`}
                  >
                    <span className="truncate text-neutral-200">
                      {file.path}
                    </span>
                    <span className="ml-2 text-neutral-500">
                      {file.index === " " ? "" : `已暂存(${file.index})`}
                      {file.worktree === " " ? "" : ` 未暂存(${file.worktree})`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {patch !== null && patch.files.length > 0 && (
              <section>
                <h2 className="mb-2 text-neutral-400 text-xs">hunk（只读）</h2>
                {patch.files.map((file) => (
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
                        <p
                          className="mt-1 font-mono text-[10px] text-neutral-500"
                          key={`${file.path}:${hunk.oldStart}:${hunk.newStart}`}
                        >
                          {hunkHeader(hunk)} · {hunk.lines.length} 行
                        </p>
                      ))}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
