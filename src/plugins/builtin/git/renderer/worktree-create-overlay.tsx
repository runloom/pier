import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@pier/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { AiStatusResult } from "@shared/contracts/ai.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
} from "@shared/worktree-naming.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  AiFieldDescription,
  buildFormSchema,
  type CreateMode,
  confirmButtonContent,
  type FormValues,
  HEAD_SENTINEL,
  PrepareBadges,
  resolveSubmitDraft,
  type SubmitPhase,
  type WorktreeCreateOverlayData,
} from "./worktree-create-form.tsx";

export type { WorktreeCreateOverlayData } from "./worktree-create-form.tsx";

const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;

interface WorktreeCreateOverlayProps {
  close: () => void;
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function focusActiveModeInput(mode: CreateMode): void {
  const target = document.getElementById(
    mode === "ai" ? "worktree-create-task" : "worktree-create-branch"
  );
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    target.focus({ preventScroll: true });
  }
}

function worktreeChildPath(rootPath: string, name: string): string {
  const trimmedRoot = rootPath.replace(TRAILING_PATH_SEPARATOR_RE, "");
  const separator =
    trimmedRoot.includes("\\") && !trimmedRoot.includes("/") ? "\\" : "/";
  return `${trimmedRoot}${separator}${name}`;
}

function WorktreeCreateOverlay({
  close,
  context,
  data,
}: WorktreeCreateOverlayProps) {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusResult | null>(null);
  const closedRef = useRef(false);

  const text = useCallback(
    (
      key: string,
      values: Record<string, number | string> | undefined,
      fallback: string
    ): string => context.i18n.t(`ui.worktreeCreate.${key}`, values, fallback),
    [context.i18n]
  );

  const schema = useMemo(
    () => buildFormSchema(data.existingBranches, text),
    [data.existingBranches, text]
  );

  const form = useForm<FormValues>({
    defaultValues: { base: HEAD_SENTINEL, branch: "", mode: "ai", text: "" },
    resolver: zodResolver(schema),
  });
  const mode = form.watch("mode");
  const branchValue = form.watch("branch");

  useEffect(() => {
    focusActiveModeInput(mode);
  }, [mode]);

  useEffect(() => {
    let disposed = false;
    context.ai
      .status()
      .then((status) => {
        if (disposed) {
          return;
        }
        setAiStatus(status);
        if (!status.configured) {
          form.setValue("mode", "custom");
        }
      })
      .catch(() => {
        if (!disposed) {
          setAiStatus({ agent: null, configured: false, label: "" });
          form.setValue("mode", "custom");
        }
      });
    return () => {
      disposed = true;
    };
  }, [context.ai, form]);

  const customDraft = useMemo<WorktreeCreationDraft | null>(() => {
    const branch = branchValue.trim();
    if (!(branch && sanitizeWorktreeName(branch))) {
      return null;
    }
    return deriveWorktreeCreation({
      existingBranches: data.existingBranches,
      existingNames: data.existingNames,
      input: branch,
    });
  }, [branchValue, data]);

  const aiConfigured = aiStatus?.configured === true;

  function closeOverlay(): void {
    closedRef.current = true;
    close();
  }

  async function openWorktreeTerminal(targetPath: string): Promise<void> {
    try {
      await context.worktrees.openTerminal({
        path: targetPath,
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

  async function onSubmit(values: FormValues): Promise<void> {
    setSubmitError(null);
    try {
      if (values.mode === "ai") {
        setPhase("generating");
      }
      const resolved = await resolveSubmitDraft({
        data,
        suggestBranch: context.ai.suggestBranch,
        text,
        values,
      });
      if ("error" in resolved || closedRef.current) {
        setSubmitError("error" in resolved ? resolved.error : null);
        setPhase("idle");
        return;
      }
      setPhase("creating");
      const { draft } = resolved;
      const result = await context.worktrees.create({
        ...(values.base === HEAD_SENTINEL ? {} : { base: values.base }),
        branch: draft.branch,
        name: draft.name,
        path: data.mainPath,
      });
      closeOverlay();
      await openWorktreeTerminal(result.targetPath);
    } catch (err) {
      setSubmitError(errorMessage(err));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const confirmDisabled = busy || (mode === "ai" && !aiConfigured);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          closeOverlay();
        }
      }}
      open
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusActiveModeInput(mode);
        }}
      >
        <DialogHeader>
          <DialogTitle>{text("title", undefined, "New Worktree")}</DialogTitle>
          <DialogDescription>
            {text(
              "description",
              undefined,
              "Create an isolated worktree for this task"
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FieldGroup className="gap-4">
            <Tabs
              onValueChange={(value) => {
                form.setValue("mode", value as CreateMode);
                form.clearErrors();
                setSubmitError(null);
              }}
              value={mode}
            >
              <TabsList className="w-full">
                <TabsTrigger disabled={busy} value="ai">
                  {text("modeAi", undefined, "Smart generation")}
                </TabsTrigger>
                <TabsTrigger disabled={busy} value="custom">
                  {text("modeCustom", undefined, "Manual naming")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === "ai" ? (
              <Field data-invalid={Boolean(form.formState.errors.text)}>
                <FieldLabel htmlFor="worktree-create-task">
                  {text("taskLabel", undefined, "Task")}
                </FieldLabel>
                <Textarea
                  disabled={busy}
                  id="worktree-create-task"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      form
                        .handleSubmit(onSubmit)()
                        .catch(() => undefined);
                    }
                  }}
                  placeholder={text(
                    "taskPlaceholder",
                    undefined,
                    "Example: fix the settings divider alignment"
                  )}
                  rows={3}
                  {...form.register("text")}
                />
                {form.formState.errors.text ? (
                  <FieldError>{form.formState.errors.text.message}</FieldError>
                ) : null}
                <AiFieldDescription
                  agentLabel={aiStatus?.label ?? ""}
                  aiConfigured={aiConfigured}
                  rootPath={data.defaults.rootPath}
                  statusLoading={aiStatus === null}
                  text={text}
                />
              </Field>
            ) : (
              <Field data-invalid={Boolean(form.formState.errors.branch)}>
                <FieldLabel htmlFor="worktree-create-branch">
                  {text("branchLabel", undefined, "Branch")}
                </FieldLabel>
                <Input
                  className="font-mono"
                  disabled={busy}
                  id="worktree-create-branch"
                  placeholder={text(
                    "branchPlaceholder",
                    undefined,
                    "feature/fix-dialog"
                  )}
                  {...form.register("branch")}
                />
                {form.formState.errors.branch ? (
                  <FieldError>
                    {form.formState.errors.branch.message}
                  </FieldError>
                ) : null}
                {customDraft ? (
                  <FieldDescription className="font-mono">
                    {worktreeChildPath(
                      data.defaults.rootPath,
                      customDraft.name
                    )}
                  </FieldDescription>
                ) : null}
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="worktree-create-base">
                {text("baseLabel", undefined, "Base")}
              </FieldLabel>
              <Controller
                control={form.control}
                name="base"
                render={({ field }) => (
                  <Select
                    disabled={busy}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      className="font-mono"
                      id="worktree-create-base"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
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
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <PrepareBadges defaults={data.defaults} text={text} />

            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </FieldGroup>

          <DialogFooter>
            <Button
              disabled={phase === "creating"}
              onClick={closeOverlay}
              type="button"
              variant="secondary"
            >
              {context.i18n.t("ui.cancel", undefined, "Cancel")}
            </Button>
            <Button disabled={confirmDisabled} type="submit" variant="default">
              {confirmButtonContent(phase, text)}
            </Button>
          </DialogFooter>
        </form>
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
