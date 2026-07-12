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
import { Field, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
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
import type { WorktreeCreatePhase } from "@shared/contracts/worktree.ts";
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
  type FormValues,
  HEAD_SENTINEL,
  PrepareBadges,
  readBranchNamePromptTemplate,
  resolveSubmitDraft,
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
  open: boolean;
  targetGroupId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CreateOperationStage = "generating" | WorktreeCreatePhase;

function currentOperationStage(ref: {
  current: CreateOperationStage;
}): CreateOperationStage {
  return ref.current;
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
  open,
  targetGroupId,
}: WorktreeCreateOverlayProps) {
  const [agentSelection, setAgentSelection] =
    useState<RendererPluginAgentSelection | null>(null);
  const operationStageRef = useRef<CreateOperationStage>("creating");
  const submittedRef = useRef(false);

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
            rankedIds: [],
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
      await context.dialogs.alert({
        body: errorMessage(err),
        title: text("launchFailed", undefined, "Terminal launch failed"),
      });
    }
  }

  async function onSubmit(values: FormValues): Promise<void> {
    if (submittedRef.current) {
      return;
    }
    submittedRef.current = true;
    operationStageRef.current =
      values.mode === "ai" ? "generating" : "creating";
    closeOverlay();
    const loading = context.notifications.loading(
      values.mode === "ai"
        ? text("generatingBranch", undefined, "Generating branch name…")
        : text("creatingWorktree", undefined, "Creating worktree…")
    );
    try {
      const resolved = await resolveSubmitDraft({
        branchNamePromptTemplate: readBranchNamePromptTemplate(
          context.configuration
        ),
        data,
        generateText: context.ai.generateText,
        text,
        values,
      });
      if ("error" in resolved) {
        loading.dismiss();
        await context.dialogs.alert({
          body: resolved.error,
          title: text(
            "generationFailed",
            undefined,
            "Branch name generation failed"
          ),
        });
        return;
      }
      const { draft } = resolved;
      operationStageRef.current = "creating";
      loading.update(text("creatingWorktree", undefined, "Creating worktree…"));
      const result = await context.worktrees.create(
        {
          ...(values.base === HEAD_SENTINEL ? {} : { base: values.base }),
          branch: draft.branch,
          name: draft.name,
          path: data.mainPath,
        },
        {
          onProgress: ({ phase: nextProgressPhase }) => {
            operationStageRef.current = nextProgressPhase;
            loading.update(
              nextProgressPhase === "initializing"
                ? text(
                    "initializingEnvironment",
                    undefined,
                    "Initializing environment…"
                  )
                : text("creatingWorktree", undefined, "Creating worktree…")
            );
          },
        }
      );
      loading.dismiss();
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
      loading.dismiss();
      const operationStage = currentOperationStage(operationStageRef);
      let failureTitle: string;
      if (operationStage === "generating") {
        failureTitle = text(
          "generationFailed",
          undefined,
          "Branch name generation failed"
        );
      } else if (operationStage === "initializing") {
        failureTitle = text(
          "initializationFailed",
          undefined,
          "Worktree created, but environment initialization failed"
        );
      } else {
        failureTitle = text(
          "createFailed",
          undefined,
          "Worktree creation failed"
        );
      }
      await context.dialogs.alert({
        body: errorMessage(err),
        title: failureTitle,
      });
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          closeOverlay();
        }
      }}
      open={open}
    >
      <DialogContent
        closeLabel={text("close", undefined, "Close")}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusActiveModeInput(mode);
        }}
        showCloseButton
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
              }}
              value={mode}
            >
              <TabsList className="w-full">
                <TabsTrigger value="ai">
                  {text("modeAi", undefined, "Smart generation")}
                </TabsTrigger>
                <TabsTrigger value="custom">
                  {text("modeCustom", undefined, "Manual naming")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === "ai" ? (
              <AiModeFields
                agentSelection={agentSelection}
                agentSelectionLoaded={agentSelectionLoaded}
                form={form}
                onSubmit={onSubmit}
                rootPath={data.defaults.rootPath}
                text={text}
              />
            ) : (
              <CustomModeField
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
                  <Select onValueChange={field.onChange} value={field.value}>
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
          </FieldGroup>

          <DialogFooter>
            <Button onClick={closeOverlay} type="button" variant="secondary">
              {context.i18n.t("ui.cancel", undefined, "Cancel")}
            </Button>
            <Button type="submit" variant="default">
              {text("confirm", undefined, "Create")}
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
    render: ({ close, open }) => (
      <WorktreeCreateOverlay
        close={close}
        context={context}
        data={data}
        open={open}
        {...(targetGroupId ? { targetGroupId } : {})}
      />
    ),
  });
}
