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
import { Field, FieldError, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type {
  RendererPluginAgentSelection,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
} from "@shared/worktree-naming.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  buildFormSchema,
  type CreateMode,
  confirmButtonContent,
  type FormValues,
  HEAD_SENTINEL,
  PrepareBadges,
  readBranchNamePromptTemplate,
  resolveSubmitDraft,
  type SubmitPhase,
  type WorktreeCreateOverlayData,
} from "./worktree-create-form.tsx";
import {
  AiModeFields,
  CustomModeField,
} from "./worktree-create-mode-fields.tsx";

export type { WorktreeCreateOverlayData } from "./worktree-create-form.tsx";

interface WorktreeCreateOverlayProps {
  close: () => void;
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
  targetGroupId?: string;
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

function WorktreeCreateOverlay({
  close,
  context,
  data,
  targetGroupId,
}: WorktreeCreateOverlayProps) {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [agentSelection, setAgentSelection] =
    useState<RendererPluginAgentSelection | null>(null);
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
    defaultValues: {
      agentId: "",
      base: HEAD_SENTINEL,
      branch: "",
      mode: "ai",
      startTask: false,
      text: "",
    },
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
        if (!status.configured) {
          form.setValue("mode", "custom");
        }
      })
      .catch(() => {
        if (!disposed) {
          form.setValue("mode", "custom");
        }
      });
    return () => {
      disposed = true;
    };
  }, [context.ai, form]);

  useEffect(() => {
    let disposed = false;
    context.agents
      .selection()
      .then((selection) => {
        if (disposed) {
          return;
        }
        setAgentSelection(selection);
        if (selection.selectedId && form.getValues("agentId") === "") {
          form.setValue("agentId", selection.selectedId);
        }
      })
      .catch(() => {
        if (!disposed) {
          setAgentSelection({
            detectedIds: [],
            enabledIds: [],
            selectedId: null,
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [context.agents, form]);

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

  const agentSelectionLoaded = agentSelection !== null;

  function closeOverlay(): void {
    closedRef.current = true;
    close();
  }

  async function openWorktreeTerminal(
    targetPath: string,
    agentId: AgentKind | null,
    taskPrompt?: string | undefined
  ): Promise<void> {
    try {
      await context.worktrees.openTerminal({
        ...(agentId ? { agentId } : {}),
        path: targetPath,
        ...(targetGroupId ? { targetGroupId } : {}),
        ...(agentId && taskPrompt ? { taskPrompt } : {}),
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
        branchNamePromptTemplate: readBranchNamePromptTemplate(
          context.configuration
        ),
        data,
        generateText: context.ai.generateText,
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
      const agentId =
        values.mode === "ai" && values.startTask && values.agentId !== ""
          ? values.agentId
          : null;
      await openWorktreeTerminal(
        result.targetPath,
        agentId,
        agentId ? values.text.trim() : undefined
      );
    } catch (err) {
      setSubmitError(errorMessage(err));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

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
              <AiModeFields
                agentSelection={agentSelection}
                agentSelectionLoaded={agentSelectionLoaded}
                busy={busy}
                form={form}
                onSubmit={onSubmit}
                rootPath={data.defaults.rootPath}
                text={text}
              />
            ) : (
              <CustomModeField
                busy={busy}
                customDraft={customDraft}
                form={form}
                rootPath={data.defaults.rootPath}
                text={text}
              />
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
            <Button disabled={busy} type="submit" variant="default">
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
  data: WorktreeCreateOverlayData,
  targetGroupId?: string
): void {
  context.overlays.open({
    id: "worktree-create",
    render: ({ close }) => (
      <WorktreeCreateOverlay
        close={close}
        context={context}
        data={data}
        {...(targetGroupId ? { targetGroupId } : {})}
      />
    ),
  });
}
