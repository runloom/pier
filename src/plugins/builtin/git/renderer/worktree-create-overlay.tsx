import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Field, FieldContent, FieldLabel, FieldSet } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PreviewRow({
  htmlFor,
  label,
  children,
}: {
  children: ReactNode;
  htmlFor?: string;
  label: string;
}) {
  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel
          className="font-normal text-muted-foreground text-sm"
          htmlFor={htmlFor}
        >
          {label}
        </FieldLabel>
      </FieldContent>
      {children}
    </Field>
  );
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text("title", undefined, "New worktree")}</DialogTitle>
          <DialogDescription>
            {text(
              "description",
              undefined,
              "Create an isolated worktree for a task"
            )}
          </DialogDescription>
        </DialogHeader>

        <FieldSet className="gap-4">
          <Field>
            <FieldLabel htmlFor="worktree-create-input">
              {text("inputLabel", undefined, "Task or branch")}
            </FieldLabel>
            <Input
              autoFocus
              disabled={creating}
              id="worktree-create-input"
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              placeholder={text(
                "inputPlaceholder",
                undefined,
                "Describe the task, or type a branch name"
              )}
              value={input}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <PreviewRow
              htmlFor="worktree-create-branch"
              label={text("branchLabel", undefined, "Branch")}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  aria-label={text("branchLabel", undefined, "Branch")}
                  className="flex-1 font-mono text-sm"
                  disabled={creating}
                  id="worktree-create-branch"
                  onChange={(event) => {
                    setBranch(event.target.value);
                    setBranchEdited(true);
                    setError(null);
                  }}
                  value={derived.branch}
                />
                {showAutoBadge ? (
                  <Badge variant="secondary">
                    {text("autoBadge", undefined, "Auto")}
                  </Badge>
                ) : null}
              </div>
            </PreviewRow>

            <PreviewRow label={text("locationLabel", undefined, "Location")}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-sm">
                {`.worktrees/${derived.name}`}
              </span>
            </PreviewRow>

            <PreviewRow
              htmlFor="worktree-create-base"
              label={text("baseLabel", undefined, "Base")}
            >
              <div className="flex min-w-0 flex-1">
                <Select
                  disabled={creating}
                  onValueChange={(value) => {
                    setBaseBranch(value === HEAD_SENTINEL ? null : value);
                    setError(null);
                  }}
                  value={baseBranch ?? HEAD_SENTINEL}
                >
                  <SelectTrigger
                    className="font-mono text-sm"
                    id="worktree-create-base"
                  >
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
              </div>
            </PreviewRow>

            <PreviewRow label={text("prepareLabel", undefined, "Prepare")}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {data.defaults.copyPatterns.length > 0 ? (
                  <Badge variant="secondary">
                    {text(
                      "prepareCopy",
                      { count: data.defaults.copyPatterns.length },
                      "Copy {{count}} ignored file patterns"
                    )}
                  </Badge>
                ) : null}
                {data.defaults.setupCommand.trim() ? (
                  <Badge variant="secondary">
                    {text("prepareSetup", undefined, "Run setup command")}
                  </Badge>
                ) : null}
                {hasPrepare ? null : (
                  <span className="text-muted-foreground text-sm">
                    {text(
                      "prepareNone",
                      undefined,
                      "No prepare steps configured"
                    )}
                  </span>
                )}
              </div>
            </PreviewRow>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </FieldSet>

        <DialogFooter>
          <Button
            disabled={creating}
            onClick={() => submit(false).catch(() => undefined)}
            type="button"
            variant="secondary"
          >
            {text("createOnlyHint", undefined, "Create only")}
          </Button>
          <Button
            disabled={creating}
            onClick={() => submit(true).catch(() => undefined)}
            type="button"
            variant="default"
          >
            {creating
              ? text("creating", undefined, "Creating…")
              : text("createAndStartHint", undefined, "Create and start")}
          </Button>
        </DialogFooter>
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
