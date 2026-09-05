import { type ReactNode, useEffect, useState } from "react";
import { cx, IconButton, NavBar, PhoneShell, QuietEmpty } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { ChangeLetter, DemoChange, DiffLine } from "./model.ts";
import {
  basename,
  changesSummary,
  fileText,
  joinPath,
  parentPath,
  type RepoScope,
} from "./repo.ts";

const LETTER_CLASS: Record<ChangeLetter, string> = {
  "?": "text-muted-foreground",
  A: "text-status-success-fg",
  D: "text-status-danger-fg",
  M: "text-status-warning-fg",
};

const REFRESH_MS = 700;

function Delta(props: { added: number; removed: number }): ReactNode {
  return (
    <span className="shrink-0 font-mono text-[12px] tabular-nums">
      {props.added > 0 ? (
        <span className="text-status-success-fg">+{props.added}</span>
      ) : null}
      {props.added > 0 && props.removed > 0 ? " " : null}
      {props.removed > 0 ? (
        <span className="text-status-danger-fg">−{props.removed}</span>
      ) : null}
    </span>
  );
}

function MonoPath(props: { path: string }): ReactNode {
  const dir = parentPath(props.path);
  const name = basename(props.path);
  return (
    <span className="block min-w-0">
      <span className="block font-medium text-[14px] text-foreground leading-5 [overflow-wrap:anywhere]">
        {name}
      </span>
      {dir.length === 0 ? null : (
        <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground leading-4">
          {dir}
        </span>
      )}
    </span>
  );
}

/**
 * S2 变更（只读）：文件列表 → 点开单文件 diff（同页切换，不推入）。
 * 一层顶栏；代码即页，不装进圆角井。电脑上不会弹出审查面板。
 */
export function ChangesScreen(props: {
  backLabel: string;
  initialPath?: string | undefined;
  onBack?: (() => void) | undefined;
  repo: RepoScope;
  scope: string;
}): ReactNode {
  const [selected, setSelected] = useState<string | null>(
    props.initialPath ?? null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [freshAt, setFreshAt] = useState<string | null>(null);

  useEffect(() => {
    if (!refreshing) {
      return;
    }
    const timer = setTimeout(() => {
      setRefreshing(false);
      setFreshAt("刚刚");
    }, REFRESH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [refreshing]);

  const summary = changesSummary(props.repo.changes);
  const current =
    selected === null
      ? null
      : (props.repo.changes.find((change) => change.path === selected) ?? null);

  const viewing = current !== null;
  return (
    <PhoneShell
      nav={
        <NavBar
          back={
            current === null
              ? { label: props.backLabel, onClick: props.onBack }
              : {
                  label: "变更",
                  onClick: () => {
                    setSelected(null);
                  },
                }
          }
          backIconOnly
          ghost={viewing}
          layout="split"
          subtitle={
            current === null ? (
              <span className="font-mono">
                {props.repo.branch}
                {summary.files === 0 ? null : (
                  <>
                    {" · "}
                    <Delta added={summary.added} removed={summary.removed} />
                  </>
                )}
                {freshAt === null ? null : ` · ${freshAt}`}
              </span>
            ) : (
              <span className="font-mono">
                <span className={LETTER_CLASS[current.letter]}>
                  {current.letter}
                </span>
                {" · "}
                <Delta added={current.added} removed={current.removed} />
              </span>
            )
          }
          title={current === null ? "变更" : basename(current.path)}
          trailing={
            current === null ? (
              <IconButton
                icon="refresh"
                label="刷新"
                onClick={() => {
                  setRefreshing(true);
                }}
                spinning={refreshing}
              />
            ) : undefined
          }
        />
      }
      tone={viewing ? "terminal" : undefined}
    >
      {current === null ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-8 [scrollbar-width:none]">
          {summary.files === 0 ? (
            <QuietEmpty
              body="这个工作树没有未提交的变更。电脑上有新改动时，这里会跟着更新。"
              title="没有变更"
            />
          ) : (
            <div className="mx-4 mt-4 flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
              {props.repo.changes.map((change) => (
                <button
                  className="flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-75 active:bg-interactive-active"
                  key={change.path}
                  onClick={() => {
                    setSelected(change.path);
                  }}
                  type="button"
                >
                  <span
                    className={cx(
                      "w-4 shrink-0 font-mono text-[13px] leading-[18px]",
                      LETTER_CLASS[change.letter]
                    )}
                  >
                    {change.letter}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                    <MonoPath path={change.path} />
                  </span>
                  <Delta added={change.added} removed={change.removed} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <DiffBlock change={current} />
      )}
    </PhoneShell>
  );
}

const DIFF_LINE_CLASS: Record<DiffLine["kind"], string> = {
  add: "bg-status-success-bg text-status-success-fg",
  ctx: "text-foreground/85",
  del: "bg-status-danger-bg text-status-danger-fg",
  meta: "text-muted-foreground italic",
};

const DIFF_MARK: Record<DiffLine["kind"], string> = {
  add: "+",
  ctx: " ",
  del: "−",
  meta: "",
};

function DiffBlock(props: { change: DemoChange }): ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-auto py-3 font-mono text-[13px] leading-5 [scrollbar-width:thin]">
      {props.change.hunks.map((hunk) => (
        <div key={hunk.header}>
          <p className="px-3 py-1.5 text-muted-foreground">{hunk.header}</p>
          {hunk.lines.map((line, index) => (
            <div
              className={cx("flex", DIFF_LINE_CLASS[line.kind])}
              key={`${hunk.header}-${index}`}
            >
              <span className="w-6 shrink-0 select-none text-center opacity-70">
                {DIFF_MARK[line.kind]}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4">
                {line.text.length === 0 ? " " : line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * S3 文件（只读）：根 = 会话工作树。目录往下走只更新列表，不推入新页。
 * 一层顶栏：根回会话，子目录回上一级，预览回目录。
 */
export function FilesScreen(props: {
  backLabel: string;
  initialDir?: string | undefined;
  initialFile?: string | undefined;
  onBack?: (() => void) | undefined;
  repo: RepoScope;
  scope: string;
}): ReactNode {
  const [dir, setDir] = useState(props.initialDir ?? "");
  const [file, setFile] = useState<string | null>(props.initialFile ?? null);
  const entries = props.repo.tree[dir] ?? [];
  const atRoot = dir.length === 0;

  const back =
    file !== null
      ? {
          label: "目录",
          onClick: () => {
            setFile(null);
          },
        }
      : atRoot
        ? { label: props.backLabel, onClick: props.onBack }
        : {
            label: "上一级",
            onClick: () => {
              setDir(parentPath(dir));
            },
          };

  const title =
    file !== null ? basename(file) : atRoot ? props.scope : basename(dir);

  return (
    <PhoneShell
      nav={
        <NavBar
          back={back}
          backIconOnly
          ghost
          layout="split"
          title={file === null && atRoot ? "文件" : title}
          subtitle={
            <span className="font-mono">
              {props.scope}
              {dir.length === 0 ? "" : ` / ${dir}`}
            </span>
          }
        />
      }
      tone="terminal"
    >
      {file === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8 text-[14px] leading-[22px] [scrollbar-width:none]">
          {entries.map((entry) => {
            const dirEntry = entry.kind === "dir";
            return (
              <button
                className="flex min-h-[52px] w-full items-center gap-3 border-b border-border/50 px-1 text-left transition-colors duration-75 active:bg-interactive-active"
                key={entry.name}
                onClick={() => {
                  if (dirEntry) {
                    setDir(joinPath(dir, entry.name));
                    return;
                  }
                  setFile(joinPath(dir, entry.name));
                }}
                type="button"
              >
                <Icon
                  className="size-[19px] shrink-0 text-muted-foreground"
                  name={dirEntry ? "folder" : "file"}
                />
                <span className="min-w-0 flex-1 py-3 [overflow-wrap:anywhere]">
                  {entry.name}
                </span>
                {dirEntry ? (
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    name="chevron-right"
                  />
                ) : (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {entry.name.split(".").pop()?.toUpperCase()}
                  </span>
                )}
              </button>
            );
          })}
          {entries.length === 0 ? (
            <p className="py-6 text-muted-foreground">这个目录是空的</p>
          ) : null}
        </div>
      ) : (
        <FilePreview text={fileText(props.repo, file)} />
      )}
    </PhoneShell>
  );
}

function FilePreview(props: { text: string }): ReactNode {
  const lines = props.text.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pt-4 pb-8 font-mono text-[13px] leading-5 [scrollbar-width:thin]">
      {lines.map((line, index) => (
        <div className="flex" key={`${index}-${line}`}>
          <span
            aria-hidden="true"
            className="w-7 shrink-0 select-none pr-3 text-right text-muted-foreground"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {line.length === 0 ? " " : tintCodeLine(line)}
          </span>
        </div>
      ))}
    </div>
  );
}

function tintCodeLine(line: string): ReactNode {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*/")
  ) {
    return <span className="text-muted-foreground">{line}</span>;
  }
  const parts = line.split(/("[^"]*"|'[^']*')/g);
  return parts.map((part, index) => {
    if (part.startsWith('"') || part.startsWith("'")) {
      return (
        <span className="text-status-success-fg" key={`${index}-${part}`}>
          {part}
        </span>
      );
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}
