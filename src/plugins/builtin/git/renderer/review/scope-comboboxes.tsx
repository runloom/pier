import { Button } from "@pier/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pier/ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@pier/ui/popover.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitCommit, GitDiffBranchOption } from "@shared/contracts/git.ts";
import { ChevronDown, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GitBranchQuickPickRow } from "../branch-quick-pick-row.tsx";
import {
  GitCommitQuickPickRow,
  shortCommitHash,
} from "../commit-quick-pick-row.tsx";
import { pluginText } from "../plugin-text.ts";

const COMMIT_SEARCH_LIMIT = 50;
const COMMIT_SEARCH_DEBOUNCE_MS = 150;
/** 分支名通常短;提交 subject 需要更宽,否则 conventional commit 会截成前缀。 */
const BRANCH_TRIGGER_MAX_CLASS = "max-w-56";
const COMMIT_TRIGGER_MAX_CLASS = "max-w-md";

function ComboboxTriggerButton({
  className,
  icon,
  label,
  placeholder,
  testId,
  ...triggerProps
}: {
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string | null;
  readonly placeholder: string;
  readonly testId: string;
} & Omit<React.ComponentProps<typeof Button>, "className">): React.JSX.Element {
  return (
    <Button
      className={cn("gap-1", BRANCH_TRIGGER_MAX_CLASS, className)}
      data-testid={testId}
      size="xs"
      // 截断时悬停仍可读完整 subject / 分支名。
      title={label ?? undefined}
      type="button"
      variant="ghost"
      {...triggerProps}
    >
      {icon}
      <span
        className={
          label === null
            ? "min-w-0 truncate text-foreground/30"
            : "min-w-0 truncate"
        }
      >
        {label ?? placeholder}
      </span>
      <ChevronDown data-icon="inline-end" />
    </Button>
  );
}

/** 触发器展示:优先 subject,解析前或空 message 时回退短 hash。 */
function commitTriggerLabel(
  selectedOid: string | null,
  selected: { oid: string; message: string } | null
): string | null {
  if (selectedOid === null) {
    return null;
  }
  if (selected?.oid === selectedOid) {
    const message = selected.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return shortCommitHash(selectedOid);
}

function commitMatchesOid(commit: GitCommit, oid: string): boolean {
  return (
    commit.hash === oid ||
    commit.hash.startsWith(oid) ||
    oid.startsWith(commit.hash)
  );
}

/** commit 二级选择:输入走 main 侧结构化搜索(非本地过滤)。 */
export function GitReviewCommitCombobox({
  context,
  gitRootPath,
  onPick,
  selectedOid,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly onPick: (commit: GitCommit) => void;
  readonly selectedOid: string | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  // 触发器 subject 缓存:选中时立即写入;外部只给 oid 时再按 hash 解析。
  const [selected, setSelected] = useState<{
    oid: string;
    message: string;
  } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (selectedOid === null) {
      setSelected(null);
      return;
    }
    const cached = selectedRef.current;
    if (cached?.oid === selectedOid && cached.message.trim().length > 0) {
      return;
    }
    let cancelled = false;
    context.git
      .searchCommits(gitRootPath, { limit: 1, query: selectedOid })
      .then((result) => {
        if (cancelled || result.status !== "ok") {
          return;
        }
        const match =
          result.items.find((commit) =>
            commitMatchesOid(commit, selectedOid)
          ) ?? null;
        if (!match) {
          return;
        }
        setSelected({ message: match.message, oid: selectedOid });
      })
      .catch(() => {
        // 解析失败保持短 hash 兜底,不打扰用户。
      });
    return () => {
      cancelled = true;
    };
  }, [context, gitRootPath, selectedOid]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      context.git
        .searchCommits(gitRootPath, { limit: COMMIT_SEARCH_LIMIT, query })
        .then((result) => {
          if (cancelled) {
            return;
          }
          setLoading(false);
          setItems(result.status === "ok" ? result.items : []);
        })
        .catch(() => {
          if (!cancelled) {
            setLoading(false);
            setItems([]);
          }
        });
    }, COMMIT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [context, gitRootPath, open, query]);
  const emptyText = loading
    ? pluginText(context, "reviewScopeSearching", "Searching…")
    : pluginText(context, "reviewScopeNoCommits", "No matching commits");
  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery("");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <ComboboxTriggerButton
          className={COMMIT_TRIGGER_MAX_CLASS}
          icon={<GitCommitHorizontal data-icon="inline-start" />}
          label={commitTriggerLabel(selectedOid, selected)}
          placeholder={pluginText(
            context,
            "reviewScopeSelectCommit",
            "Select a commit"
          )}
          testId="git-review-commit-combobox"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <Command
          label={pluginText(
            context,
            "reviewScopeSelectCommit",
            "Select a commit"
          )}
          shouldFilter={false}
        >
          <CommandInput
            aria-label={pluginText(
              context,
              "reviewScopeCommitSearchPlaceholder",
              "Search: text, #hash, @author, :path"
            )}
            onValueChange={setQuery}
            placeholder={pluginText(
              context,
              "reviewScopeCommitSearchPlaceholder",
              "Search: text, #hash, @author, :path"
            )}
            value={query}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((commit) => (
                <CommandItem
                  key={commit.hash}
                  onSelect={() => {
                    setOpen(false);
                    setQuery("");
                    setSelected({ message: commit.message, oid: commit.hash });
                    onPick(commit);
                  }}
                  value={commit.hash}
                >
                  <GitCommitQuickPickRow commit={commit} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** branch 二级选择:打开时一次拉全量候选,输入由 cmdk 本地过滤。 */
export function GitReviewBranchCombobox({
  context,
  gitRootPath,
  onPick,
  selectedRef,
}: {
  readonly context: RendererPluginContext;
  readonly gitRootPath: string;
  readonly onPick: (branch: GitDiffBranchOption) => void;
  readonly selectedRef: string | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly GitDiffBranchOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    context.git
      .searchBranches(gitRootPath, {
        diffMode: "commitGraph",
        limit: 1000,
        query: "",
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setItems(
          result.status === "ok"
            ? result.items.filter((branch) => !branch.current)
            : []
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [context, gitRootPath, open]);
  const emptyText = loading
    ? pluginText(context, "reviewScopeSearching", "Searching…")
    : pluginText(context, "reviewScopeNoBranches", "No matching branches");
  const rowText = {
    defaultLabel: pluginText(context, "branchDefault", "default"),
    graphCaveatTitle: pluginText(
      context,
      "branchGraphCaveatTitle",
      "Counts commit divergence only. Squash or rebase merges may show already-applied commits as branch-only."
    ),
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <ComboboxTriggerButton
          icon={<GitBranch data-icon="inline-start" />}
          label={selectedRef}
          placeholder={pluginText(
            context,
            "reviewScopeSelectBranch",
            "Select a branch"
          )}
          testId="git-review-branch-combobox"
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <Command
          label={pluginText(
            context,
            "reviewScopeSelectBranch",
            "Select a branch"
          )}
        >
          <CommandInput
            aria-label={pluginText(
              context,
              "reviewScopeBranchSearchPlaceholder",
              "Search branches"
            )}
            placeholder={pluginText(
              context,
              "reviewScopeBranchSearchPlaceholder",
              "Search branches"
            )}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((branch) => (
                <CommandItem
                  key={branch.id}
                  keywords={[branch.name, branch.refName]}
                  onSelect={() => {
                    setOpen(false);
                    onPick(branch);
                  }}
                  value={branch.id}
                >
                  <GitBranchQuickPickRow
                    branch={branch}
                    defaultLabel={rowText.defaultLabel}
                    graphCaveatTitle={rowText.graphCaveatTitle}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
