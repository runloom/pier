import { FieldSet } from "@pier/ui/field.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import {
  type ChangeEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import {
  type CopyPatternRow,
  EnvironmentCopyPatternsTable,
  patternListsEqual,
  patternsToRows,
  rowsToPatterns,
} from "./environment-copy-patterns-table.tsx";
import {
  EnvironmentVarsTable,
  type EnvVarRow,
  envRecordsEqual,
  envToRows,
  rowsToEnv,
} from "./environment-vars-table.tsx";

export interface EnvironmentEditorHandle {
  save(): Promise<void>;
}

export interface EnvironmentEditorProps {
  onDirtyChange?: (dirty: boolean) => void;
  project: LocalEnvironmentProject;
  ref?: Ref<EnvironmentEditorHandle>;
}

export function EnvironmentEditor({
  onDirtyChange,
  project,
  ref,
}: EnvironmentEditorProps) {
  const t = useT();
  const updateProject = useLocalEnvironmentsStore((s) => s.updateProject);
  const editorId = useId();
  const setupId = `${editorId}-env-setup`;
  const cleanupId = `${editorId}-env-cleanup`;

  const [setupCommand, setSetupCommand] = useState(project.setupCommand);
  const [cleanupCommand, setCleanupCommand] = useState(project.cleanupCommand);
  const [envRows, setEnvRows] = useState<EnvVarRow[]>(() =>
    envToRows(project.env)
  );
  const [patternRows, setPatternRows] = useState<CopyPatternRow[]>(() =>
    patternsToRows(project.copyPatterns)
  );

  const draftEnv = rowsToEnv(envRows);
  const draftPatterns = rowsToPatterns(patternRows);
  const dirty =
    setupCommand !== project.setupCommand ||
    cleanupCommand !== project.cleanupCommand ||
    !envRecordsEqual(draftEnv, project.env) ||
    !patternListsEqual(draftPatterns, project.copyPatterns);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save(): Promise<void> {
    if (!dirty) {
      return;
    }
    await updateProject({
      cleanupCommand,
      copyPatterns: draftPatterns,
      env: draftEnv,
      projectRootPath: project.projectRootPath,
      setupCommand,
    });
  }

  useImperativeHandle(ref, () => ({ save }));

  return (
    <FieldSet>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="font-medium text-sm" htmlFor={setupId}>
            {t("settings.environment.setupCommand")}
          </label>
          <Textarea
            className="min-h-32 w-full font-mono"
            id={setupId}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setSetupCommand(e.target.value)
            }
            placeholder={t("settings.environment.setupHint")}
            value={setupCommand}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-medium text-sm" htmlFor={cleanupId}>
            {t("settings.environment.cleanupCommand")}
          </label>
          <Textarea
            className="min-h-32 w-full font-mono"
            id={cleanupId}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setCleanupCommand(e.target.value)
            }
            placeholder={t("settings.environment.cleanupHint")}
            value={cleanupCommand}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">
              {t("settings.environment.copyPatterns.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("settings.environment.copyPatterns.hint")}
            </span>
          </div>
          <EnvironmentCopyPatternsTable
            onChange={setPatternRows}
            rows={patternRows}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-medium text-sm">
            {t("settings.environment.envVars.title")}
          </span>
          <EnvironmentVarsTable onChange={setEnvRows} rows={envRows} />
        </div>
      </div>
    </FieldSet>
  );
}
