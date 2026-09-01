/**
 * S2 变更页（只读）：文件列表 → 点文件懒加载单文件 unified diff。
 * 作用域：路由 cwd 优先；无参数回退快照启发式。
 */
import type {
  GitDiffPatch,
  GitFileStatus,
  GitStatus,
} from "@shared/contracts/git.ts";
import { gitDiffPatchSchema, gitStatusSchema } from "@shared/contracts/git.ts";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { hunkLineDelta, UnifiedDiff } from "../components/unified-diff.tsx";
import { useHashRoute } from "../lib/routes.ts";
import { getMobileClient } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";
import { pickWorktreeCwd } from "../lib/worktree-scope.ts";

export { pickWorktreeCwd } from "../lib/worktree-scope.ts";

function describeGitReadError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  if (/not a git repository/i.test(message)) {
    return "当前目录不是 git 仓库";
  }
  if (/missing capability:\s*git:read/i.test(message)) {
    return "这台设备没有读取变更的权限，请重新扫码配对";
  }
  if (/timed? ?out/i.test(message)) {
    return "读取变更超时，请稍后重试";
  }
  if (message.length > 0 && message.length < 240) {
    return message;
  }
  return fallback;
}

function statusLetter(file: GitFileStatus): string {
  if (file.index === "U" || file.worktree === "U") {
    return "U";
  }
  if (file.index === "?" || file.worktree === "?") {
    return "?";
  }
  if (file.worktree !== " " && file.worktree !== ".") {
    return file.worktree;
  }
  if (file.index !== " " && file.index !== ".") {
    return file.index;
  }
  return "M";
}

function isStagedOnly(file: GitFileStatus): boolean {
  return (
    file.worktree === " " &&
    file.index !== " " &&
    file.index !== "?" &&
    file.index !== "."
  );
}

export function ChangesPage() {
  const route = useHashRoute();
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const routeCwd = route.page === "changes" ? route.cwd : undefined;
  const cwd = routeCwd ?? pickWorktreeCwd(snapshot);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [patch, setPatch] = useState<GitDiffPatch | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const patchGeneration = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce 是手动刷新触发器，体不读取
  useEffect(() => {
    patchGeneration.current += 1;
    setSelectedPath(null);
    setPatch(null);
    setPatchError(null);
    setStatus(null);
    if (cwd === null) {
      return;
    }
    let alive = true;
    getMobileClient()
      .command({ cwd, type: "git.getStatus" })
      .then((raw) => {
        const parsed = gitStatusSchema.parse(raw);
        if (alive) {
          setStatus(parsed);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(describeGitReadError(err, "读取状态失败"));
        }
      });
    return () => {
      alive = false;
    };
  }, [cwd, reloadNonce]);

  const openFile = (file: GitFileStatus) => {
    if (cwd === null) {
      return;
    }
    const requestedPath = file.path;
    const generation = patchGeneration.current + 1;
    patchGeneration.current = generation;
    setSelectedPath(requestedPath);
    setPatch(null);
    setPatchError(null);
    getMobileClient()
      .command({
        cwd,
        options: {
          paths: [requestedPath],
          ...(isStagedOnly(file) ? { staged: true } : {}),
        },
        type: "git.getDiffPatch",
      })
      .then((raw) => {
        if (generation !== patchGeneration.current) {
          return;
        }
        const parsed = gitDiffPatchSchema.parse(raw);
        setPatch(parsed);
      })
      .catch((err: unknown) => {
        if (generation !== patchGeneration.current) {
          return;
        }
        setPatchError(describeGitReadError(err, "读取 diff 失败"));
      });
  };

  const selectedFile =
    selectedPath === null
      ? null
      : (status?.files.find((file) => file.path === selectedPath) ?? null);
  const selectedDelta =
    patch === null
      ? null
      : hunkLineDelta(patch.files.flatMap((file) => file.hunks));

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title="变更 · 只读" />
      <main className="flex-1 px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p
            className="truncate text-[10px] text-neutral-500"
            data-testid="changes-cwd"
          >
            {cwd ?? "无法确定工作树目录"}
          </p>
          <button
            className="min-h-9 shrink-0 rounded-md border border-neutral-700 px-3 text-neutral-300 text-xs active:bg-neutral-800"
            data-testid="changes-refresh"
            onClick={() => {
              setReloadNonce((nonce) => nonce + 1);
            }}
            type="button"
          >
            刷新
          </button>
        </div>
        {error !== null && (
          <p className="mb-3 text-red-400 text-xs" role="alert">
            {error}
          </p>
        )}
        {status === null && error === null && cwd !== null && (
          <p className="text-neutral-500 text-sm">读取中…</p>
        )}
        {status !== null && (
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
                {status.changeSummary.kind === "lineDelta" &&
                  ` · +${status.changeSummary.insertions} −${status.changeSummary.deletions}`}
              </p>
            </section>
            {selectedPath === null ? (
              <section>
                <h2 className="mb-2 text-neutral-400 text-xs">文件</h2>
                {status.files.length === 0 ? (
                  <p className="text-neutral-500 text-sm">没有变更</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {status.files.map((file) => (
                      <li key={`${file.path}:${file.worktree}`}>
                        <button
                          className="flex min-h-10 w-full items-center justify-between rounded font-mono text-xs active:bg-neutral-900"
                          data-testid="git-file"
                          onClick={() => {
                            openFile(file);
                          }}
                          type="button"
                        >
                          <span className="truncate text-neutral-200">
                            <span className="mr-2 text-neutral-500">
                              {statusLetter(file)}
                            </span>
                            {file.path}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <section>
                <button
                  className="mb-2 min-h-9 rounded-md border border-neutral-700 px-3 text-neutral-300 text-xs active:bg-neutral-800"
                  data-testid="git-diff-back"
                  onClick={() => {
                    patchGeneration.current += 1;
                    setSelectedPath(null);
                    setPatch(null);
                    setPatchError(null);
                  }}
                  type="button"
                >
                  ‹ 文件列表
                </button>
                <p className="mb-2 font-mono text-[11px] text-neutral-200">
                  {selectedFile !== null && (
                    <span className="mr-2 text-neutral-500">
                      {statusLetter(selectedFile)}
                    </span>
                  )}
                  {selectedPath}
                  {selectedDelta !== null &&
                    ` · +${selectedDelta.insertions} −${selectedDelta.deletions}`}
                </p>
                {patchError !== null && (
                  <p className="text-red-400 text-xs" role="alert">
                    {patchError}
                  </p>
                )}
                {patch === null && patchError === null && (
                  <p className="text-neutral-500 text-sm">读取 diff…</p>
                )}
                {patch !== null && patch.files.length === 0 && (
                  <p className="text-neutral-500 text-sm">
                    没有可显示的 diff（可能是未跟踪文件）
                  </p>
                )}
                {patch !== null && patch.files.length > 0 && (
                  <UnifiedDiff files={patch.files} />
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
