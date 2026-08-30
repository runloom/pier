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
import type { GitDiffBranchOption } from "@shared/contracts/git.ts";
import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { GitBranchQuickPickRow } from "../../branch-quick-pick-row.tsx";
import { pluginText } from "../../plugin-text.ts";
import { ComboboxTriggerButton } from "./combobox-trigger.tsx";

export { GitReviewCommitCombobox } from "./commit-combobox.tsx";
export { GitReviewCommitPickerSession } from "./commit-picker-session.tsx";

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
