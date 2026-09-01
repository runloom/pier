/**
 * S3 文件页（只读）：file.list / file.readText 浏览会话工作树。
 * 根路径用路由 root；支持 path 直开预览；无参数回退快照启发式。
 */

import type { FileEntry, FileListResult } from "@shared/contracts/file.ts";
import { fileListResultSchema } from "@shared/contracts/file.ts";
import { useEffect, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { useHashRoute } from "../lib/routes.ts";
import { getMobileClient } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";
import { parentDir, pickFileRoot } from "../lib/worktree-scope.ts";

export { pickFileRoot } from "../lib/worktree-scope.ts";

const PREVIEW_MAX_CHARS = 8192;

export function FilesPage() {
  const route = useHashRoute();
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const routeRoot = route.page === "files" ? route.root : undefined;
  const routePath = route.page === "files" ? route.path : undefined;
  const root = routeRoot ?? pickFileRoot(snapshot);
  const [path, setPath] = useState(() =>
    routePath === undefined ? "" : parentDir(routePath)
  );
  const [entries, setEntries] = useState<FileListResult>([]);
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setPath(routePath === undefined ? "" : parentDir(routePath));
    setPreview(null);
    setPreviewError(null);
    if (root === null) {
      setEntries([]);
    }
  }, [root, routePath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce 是手动刷新触发器，体不读取
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
  }, [root, path, reloadNonce]);

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

  useEffect(() => {
    if (root === null || routePath === undefined || routePath.length === 0) {
      return;
    }
    let alive = true;
    getMobileClient()
      .command<unknown>({
        path: routePath,
        root,
        type: "file.readText",
      })
      .then((result) => {
        if (!alive) {
          return;
        }
        if (typeof result !== "string") {
          setPreviewError(`无法预览 ${routePath}：读取结果不是文本`);
          return;
        }
        if (result.includes("\0")) {
          setPreviewError(`无法预览 ${routePath}：二进制文件不支持文本预览`);
          return;
        }
        setPreviewError(null);
        setPreview({
          path: routePath,
          text: result.slice(0, PREVIEW_MAX_CHARS),
        });
      })
      .catch((err: unknown) => {
        if (alive) {
          setPreviewError(err instanceof Error ? err.message : "文件读取失败");
        }
      });
    return () => {
      alive = false;
    };
  }, [root, routePath]);

  const directories = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "file");

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title="文件 · 只读" />
      <main className="flex flex-1 flex-col px-4 py-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p
            className="truncate text-[10px] text-neutral-500"
            data-testid="files-root"
          >
            {root ?? "无法确定工作树根目录"}
            {path.length > 0 && ` / ${path}`}
          </p>
          <button
            className="min-h-9 shrink-0 rounded-md border border-neutral-700 px-3 text-neutral-300 text-xs active:bg-neutral-800"
            data-testid="files-refresh"
            onClick={() => {
              setReloadNonce((nonce) => nonce + 1);
            }}
            type="button"
          >
            刷新
          </button>
        </div>
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
                    className="min-h-10 w-full rounded text-left font-mono text-neutral-400 text-xs active:bg-neutral-900"
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
                    className="min-h-10 w-full rounded text-left font-mono text-neutral-300 text-xs active:bg-neutral-900"
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
                    className="min-h-10 w-full rounded text-left font-mono text-neutral-200 text-xs active:bg-neutral-900"
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
