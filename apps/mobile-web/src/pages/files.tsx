/**
 * S3 文件页（只读）：file.list / file.readText 浏览当前工作树。
 * root 取快照首个 worktree 的 canonicalPath（缺省 path）；只读预览。
 */

import type { FileEntry, FileListResult } from "@shared/contracts/file.ts";
import { fileListResultSchema } from "@shared/contracts/file.ts";
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { getMobileClient } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

const PREVIEW_MAX_CHARS = 8192;

export function pickFileRoot(
  snapshot: ControlSnapshotPayload | null
): string | null {
  if (snapshot === null) {
    return null;
  }
  const worktree = snapshot.worktrees[0];
  if (worktree === undefined) {
    return null;
  }
  return worktree.canonicalPath ?? worktree.path;
}

export function FilesPage() {
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const root = pickFileRoot(snapshot);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileListResult>([]);
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (root === null) {
      return;
    }
    let alive = true;
    setError(null);
    getMobileClient()
      .command({ path, root, type: "file.list" })
      .then((raw) => {
        const parsed = fileListResultSchema.parse(raw);
        if (alive) {
          setEntries(parsed);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : "目录读取失败");
        }
      });
    return () => {
      alive = false;
    };
  }, [root, path]);

  const openFile = (entry: FileEntry) => {
    if (root === null) {
      return;
    }
    setPreview(null);
    setPreviewError(null);
    getMobileClient()
      .command<unknown>({
        path: entry.path,
        root,
        type: "file.readText",
      })
      .then((result) => {
        // file.readText 契约：裸 string（utf8 解码）。非 string 一律按失败处理。
        if (typeof result !== "string") {
          setPreviewError(`无法预览 ${entry.path}：读取结果不是文本`);
          return;
        }
        if (result.includes("\0")) {
          setPreviewError(`无法预览 ${entry.path}：二进制文件不支持文本预览`);
          return;
        }
        setPreviewError(null);
        setPreview({
          path: entry.path,
          text: result.slice(0, PREVIEW_MAX_CHARS),
        });
      })
      .catch((err: unknown) => {
        setPreviewError(err instanceof Error ? err.message : "文件读取失败");
      });
  };

  const directories = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "file");

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title="文件 · 只读" />
      <main className="flex flex-1 flex-col px-4 py-4">
        <p
          className="mb-2 text-[10px] text-neutral-500"
          data-testid="files-root"
        >
          {root ?? "无法确定工作树根目录"}
          {path.length > 0 && ` / ${path}`}
        </p>
        {error !== null && (
          <p className="mb-2 text-red-400 text-xs" role="alert">
            {error}
          </p>
        )}
        {root === null ? (
          <p className="mt-8 text-center text-neutral-500 text-sm">
            等待快照以确定工作树
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1" data-testid="file-list">
              {path.length > 0 && (
                <li>
                  <button
                    className="font-mono text-[11px] text-neutral-400"
                    data-testid="file-up"
                    onClick={() => {
                      const parent = path.split("/").slice(0, -1).join("/");
                      setPath(parent);
                      setPreview(null);
                    }}
                    type="button"
                  >
                    ../
                  </button>
                </li>
              )}
              {directories.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="font-mono text-[11px] text-neutral-300"
                    data-testid={`dir-${entry.path}`}
                    onClick={() => {
                      setPath(entry.path);
                      setPreview(null);
                    }}
                    type="button"
                  >
                    {entry.path}/
                  </button>
                </li>
              ))}
              {files.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="font-mono text-[11px] text-neutral-200"
                    data-testid={`file-${entry.path}`}
                    onClick={() => {
                      openFile(entry);
                    }}
                    type="button"
                  >
                    {entry.path}
                  </button>
                </li>
              ))}
            </ul>
            {previewError !== null && (
              <p
                className="mt-3 text-red-400 text-xs"
                data-testid="file-preview-error"
                role="alert"
              >
                {previewError}
              </p>
            )}
            {preview !== null && previewError === null && (
              <section className="mt-4 border-neutral-800 border-t pt-3">
                <h2 className="mb-1 text-neutral-400 text-xs">
                  只读预览 · {preview.path}
                </h2>
                <pre
                  className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-neutral-200"
                  data-testid="file-preview"
                >
                  {preview.text}
                </pre>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
