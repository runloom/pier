import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import { AgentSelect } from "@plugins/api/components/agent-select.tsx";
import type { RendererPluginAgentSelection } from "@plugins/api/renderer.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import {
  AiFieldDescription,
  type FormValues,
  type TextFn,
} from "./worktree-create-form.tsx";

const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;

function worktreeChildPath(rootPath: string, name: string): string {
  const trimmedRoot = rootPath.replace(TRAILING_PATH_SEPARATOR_RE, "");
  const separator =
    trimmedRoot.includes("\\") && !trimmedRoot.includes("/") ? "\\" : "/";
  return `${trimmedRoot}${separator}${name}`;
}

export function AiModeFields({
  agentSelection,
  agentSelectionLoaded,
  form,
  onSubmit,
  rootPath,
  text,
}: {
  agentSelection: RendererPluginAgentSelection | null;
  agentSelectionLoaded: boolean;
  form: UseFormReturn<FormValues>;
  onSubmit: (values: FormValues) => Promise<void>;
  rootPath: string;
  text: TextFn;
}) {
  const enabledAgentIds = agentSelection?.rankedIds ?? [];
  const canStartAgentTask = enabledAgentIds.length > 0;
  const defaultAgentId = agentSelection?.selectedId ?? null;
  const agentId = useWatch({ control: form.control, name: "agentId" });
  const startTask = useWatch({ control: form.control, name: "startTask" });

  return (
    <>
      <Field data-invalid={Boolean(form.formState.errors.text)}>
        <FieldLabel htmlFor="worktree-create-task">
          {text("taskLabel", undefined, "Task")}
        </FieldLabel>
        <Textarea
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
        <AiFieldDescription rootPath={rootPath} text={text} />
      </Field>
      <Field
        className="!items-center"
        data-disabled={!canStartAgentTask || undefined}
        orientation="horizontal"
      >
        <FieldContent>
          <FieldLabel htmlFor="worktree-create-start-task">
            {text("startTaskLabel", undefined, "Start task now")}
          </FieldLabel>
          <FieldDescription>
            {canStartAgentTask
              ? text(
                  "startTaskHint",
                  undefined,
                  "Open a new agent conversation in the created worktree."
                )
              : text(
                  "startTaskNoAgents",
                  undefined,
                  "No enabled agent is available."
                )}
          </FieldDescription>
        </FieldContent>
        <Controller
          control={form.control}
          name="startTask"
          render={({ field }) => (
            <Switch
              checked={field.value}
              disabled={!(agentSelectionLoaded && canStartAgentTask)}
              id="worktree-create-start-task"
              onCheckedChange={(checked) => {
                field.onChange(checked);
                if (
                  checked &&
                  form.getValues("agentId") === "" &&
                  defaultAgentId
                ) {
                  form.setValue("agentId", defaultAgentId, {
                    shouldValidate: true,
                  });
                }
              }}
            />
          )}
        />
      </Field>
      {startTask ? (
        <Controller
          control={form.control}
          name="agentId"
          render={({ field }) => (
            <Field data-invalid={Boolean(form.formState.errors.agentId)}>
              <FieldLabel htmlFor="worktree-create-agent">
                {text("agentLabel", undefined, "Agent")}
              </FieldLabel>
              <AgentSelect
                agentIds={enabledAgentIds}
                disabled={!canStartAgentTask}
                emptyLabel={text("agentEmpty", undefined, "No enabled agents")}
                id="worktree-create-agent"
                onValueChange={(next) => field.onChange(next)}
                placeholder={text(
                  "agentPlaceholder",
                  undefined,
                  "Select an agent"
                )}
                value={agentId}
              />
              {form.formState.errors.agentId ? (
                <FieldError>{form.formState.errors.agentId.message}</FieldError>
              ) : null}
            </Field>
          )}
        />
      ) : null}
    </>
  );
}

export function CustomModeField({
  customDraft,
  form,
  rootPath,
  text,
}: {
  customDraft: WorktreeCreationDraft | null;
  form: UseFormReturn<FormValues>;
  rootPath: string;
  text: TextFn;
}) {
  return (
    <Field data-invalid={Boolean(form.formState.errors.branch)}>
      <FieldLabel htmlFor="worktree-create-branch">
        {text("branchLabel", undefined, "Branch")}
      </FieldLabel>
      <Input
        className="font-mono"
        id="worktree-create-branch"
        placeholder={text("branchPlaceholder", undefined, "feature/fix-dialog")}
        {...form.register("branch")}
      />
      {form.formState.errors.branch ? (
        <FieldError>{form.formState.errors.branch.message}</FieldError>
      ) : null}
      {customDraft ? (
        <FieldDescription className="font-mono">
          {worktreeChildPath(rootPath, customDraft.name)}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
