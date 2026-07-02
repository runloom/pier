import { Badge } from "@pier/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Input } from "@pier/ui/input.tsx";
import { InputGroup, InputGroupInput } from "@pier/ui/input-group.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type { WorktreeCreationDefaults } from "@shared/contracts/worktree.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
} from "@shared/worktree-naming.ts";
import { GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

const HEAD_SENTINEL = "__head__";

export interface WorktreeCreateOverlayData {
  branches: readonly GitBranchRef[];
  defaults: WorktreeCreationDefaults;
  existingBranches: readonly string[];
  existingNames: readonly string[];
  mainPath: string;
}

interface WorktreeCreateOverlayProps {
  close: () => void;
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
}

function FieldRow({ label, children }: { children: ReactNode; label: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      {children}
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function WorktreeCreateOverlay({
  close,
  context,
  data,
}: WorktreeCreateOverlayProps) {
  const [input, setInput] = useState("");
  const [branch, setBranch] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const text = (
    key: string,
    values: Record<string, number | string> | undefined,
    fallback: string
  ): string => context.i18n.t(`ui.worktreeCreate.${key}`, values, fallback);

  const derived = useMemo<WorktreeCreationDraft>(() => {
    if (branchEdited) {
      return {
        branch,
        name: sanitizeWorktreeName(branch) || "worktree",
        source: "branch",
      };
    }
    return deriveWorktreeCreation({
      branchPrefix: data.defaults.branchPrefix,
      existingBranches: data.existingBranches,
      existingNames: data.existingNames,
      input,
    });
  }, [branch, branchEdited, input, data]);

  const showAutoBadge = derived.source !== "branch" && !branchEdited;
  const hasPrepare =
    data.defaults.copyPatterns.length > 0 ||
    data.defaults.setupCommand.trim() !== "";

  async function submit(start: boolean): Promise<void> {
    if (creating) {
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const result = await context.worktrees.create({
        ...(baseBranch ? { base: baseBranch } : {}),
        branch: derived.branch,
        name: derived.name,
        path: data.mainPath,
      });
      close();
      context.notifications.success(`${derived.branch} · ${result.targetPath}`);
      if (start) {
        try {
          await context.worktrees.openTerminal({
            path: result.targetPath,
            runSetup: true,
          });
        } catch (err) {
          context.notifications.error(
            text(
              "launchFailed",
              { message: errorMessage(err) },
              "Terminal launch failed: {{message}}"
            )
          );
        }
      }
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <DialogContent
        className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-3xl! p-0 sm:max-w-130"
        closeOnOverlayClick
        initialFocus="firstFocusable"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{text("title", undefined, "New worktree")}</DialogTitle>
          <DialogDescription>
            {text(
              "description",
              undefined,
              "Create an isolated worktree for a task"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1.5 px-3 pt-2.5 text-muted-foreground text-xs">
          <GitBranch className="size-3.5" />
          {text("title", undefined, "New worktree")}
        </div>
        <div className="p-1">
          <InputGroup className="h-8! bg-input/50">
            <InputGroupInput
              aria-label={text("title", undefined, "New worktree")}
              autoFocus
              disabled={creating}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                submit(!event.shiftKey).catch(() => undefined);
              }}
              placeholder={text(
                "inputPlaceholder",
                undefined,
                "Describe the task, or type a branch name"
              )}
              value={input}
            />
          </InputGroup>
        </div>
        <div className="grid grid-cols-[52px_1fr] items-center gap-x-3 gap-y-1.5 px-3 pt-1 pb-2.5 text-xs">
          <FieldRow label={text("branchLabel", undefined, "Branch")}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Input
                aria-label={text("branchLabel", undefined, "Branch")}
                className="h-6 flex-1 rounded-lg px-2 py-0 font-mono text-xs"
                disabled={creating}
                onChange={(event) => {
                  setBranch(event.target.value);
                  setBranchEdited(true);
                  setError(null);
                }}
                value={derived.branch}
              />
              {showAutoBadge ? (
                <Badge className="h-4.5 px-1.5 text-[10px]" variant="secondary">
                  {text("autoBadge", undefined, "Auto")}
                </Badge>
              ) : null}
            </span>
          </FieldRow>
          <FieldRow label={text("locationLabel", undefined, "Location")}>
            <span className="truncate px-2 font-mono text-muted-foreground">
              {`.worktrees/${derived.name}`}
            </span>
          </FieldRow>
          <FieldRow label={text("baseLabel", undefined, "Base")}>
            <span className="flex min-w-0 items-center">
              <Select
                disabled={creating}
                onValueChange={(value) => {
                  setBaseBranch(value === HEAD_SENTINEL ? null : value);
                  setError(null);
                }}
                value={baseBranch ?? HEAD_SENTINEL}
              >
                <SelectTrigger className="h-6 w-fit gap-1 rounded-lg border-transparent bg-input/50 px-2 font-mono text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HEAD_SENTINEL}>
                    {text("baseHead", undefined, "Current HEAD")}
                  </SelectItem>
                  {data.branches.map((ref) => (
                    <SelectItem
                      key={`${ref.kind}:${ref.name}`}
                      value={ref.name}
                    >
                      {ref.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          </FieldRow>
          <FieldRow label={text("prepareLabel", undefined, "Prepare")}>
            <span className="flex min-w-0 flex-wrap items-center gap-1 px-2">
              {data.defaults.copyPatterns.length > 0 ? (
                <Badge
                  className="h-4.5 px-1.5 font-normal text-[10px]"
                  variant="secondary"
                >
                  {text(
                    "prepareCopy",
                    { count: data.defaults.copyPatterns.length },
                    "Copy {{count}} ignored file patterns"
                  )}
                </Badge>
              ) : null}
              {data.defaults.setupCommand.trim() ? (
                <Badge
                  className="h-4.5 px-1.5 font-normal text-[10px]"
                  variant="secondary"
                >
                  {text("prepareSetup", undefined, "Run setup command")}
                </Badge>
              ) : null}
              {hasPrepare ? null : (
                <span className="text-muted-foreground">
                  {text(
                    "prepareNone",
                    undefined,
                    "No prepare steps configured"
                  )}
                </span>
              )}
            </span>
          </FieldRow>
        </div>
        {error ? (
          <p className="px-3 pb-2 text-destructive text-xs">{error}</p>
        ) : null}
        <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Kbd>⏎</Kbd>
            {creating
              ? text("creating", undefined, "Creating…")
              : text("createAndStartHint", undefined, "Create and start")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧⏎</Kbd>
            {text("createOnlyHint", undefined, "Create only")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            {text("cancelHint", undefined, "Cancel")}
          </span>
          <span className="ml-auto truncate">
            {text(
              "emptyHint",
              undefined,
              "Empty input creates an auto codename"
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function openWorktreeCreateOverlay(
  context: RendererPluginContext,
  data: WorktreeCreateOverlayData
): void {
  context.overlays.open({
    id: "worktree-create",
    render: ({ close }) => (
      <WorktreeCreateOverlay close={close} context={context} data={data} />
    ),
  });
}
