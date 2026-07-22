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
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitCommit, GitDiffBranchOption } from "@shared/contracts/git.ts";
import { ChevronDown, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { GitBranchQuickPickRow } from "./git-branch-quick-pick-row.tsx";
import {
  GitCommitQuickPickRow,
  shortCommitHash,
} from "./git-commit-quick-pick-row.tsx";
import { pluginText } from "./git-plugin-text.ts";

const COMMIT_SEARCH_LIMIT = 50;
const COMMIT_SEARCH_DEBOUNCE_MS = 150;

function ComboboxTriggerButton({
  icon,
  label,
  placeholder,
  testId,
  ...triggerProps
}: {
  readonly icon: React.ReactNode;
  readonly label: string | null;
  readonly placeholder: string;
  readonly testId: string;
} & React.ComponentProps<typeof Button>): React.JSX.Element {
  return (
    <Button
      className="max-w-56 gap-1"
      data-testid={testId}
      size="xs"
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
          icon={<GitCommitHorizontal data-icon="inline-start" />}
          label={selectedOid === null ? null : shortCommitHash(selectedOid)}
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
