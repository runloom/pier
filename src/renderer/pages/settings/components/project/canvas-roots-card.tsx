import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  loadLiveModulesProjectConfig,
  saveLiveModulesProjectConfig,
} from "@plugins/api/live-modules-project-config.ts";
import { applyLiveModulesProjectConfigAfterSave } from "@plugins/api/live-modules-project-config-cache.ts";
import { LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES } from "@shared/contracts/live-modules.ts";
import {
  LIVE_MODULE_MAX_CONTENT_DIRECTORIES,
  normalizeContentDirectory,
  normalizeContentDirectoryList,
} from "@shared/live-module-canvas-path.ts";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

let nextRowId = 0;
function createRow(path = ""): { id: string; path: string } {
  nextRowId += 1;
  return { id: `canvas-root-row-${nextRowId}`, path };
}

function rowsFromDirectories(directories: readonly string[]): {
  id: string;
  path: string;
}[] {
  if (directories.length === 0) {
    return [createRow()];
  }
  return directories.map((path) => createRow(path));
}

/**
 * Project → General: full editable list of canvas preview content roots.
 */
export function ProjectCanvasRootsCard({
  projectRootPath,
}: {
  projectRootPath: string;
}) {
  const t = useT();
  const baseId = useId();
  const [rows, setRows] = useState(() =>
    rowsFromDirectories(LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES)
  );
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await loadLiveModulesProjectConfig(projectRootPath);
    setLoading(false);
    if (result.kind === "failed") {
      showAppAlert({
        title: t("settings.projects.general.canvasRootsLoadFailed"),
        body: result.message,
      }).catch(() => undefined);
      return;
    }
    setRevision(result.revision);
    setRows(rowsFromDirectories(result.contentDirectories));
    setRowErrors(new Map());
    setDirty(false);
  }, [projectRootPath, t]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  function updateRow(index: number, path: string): void {
    setDirty(true);
    setRowErrors(new Map());
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, path } : row))
    );
  }

  function removeRow(index: number): void {
    setDirty(true);
    setRowErrors(new Map());
    setRows((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [createRow()];
    });
  }

  function addRow(): void {
    if (rows.length >= LIVE_MODULE_MAX_CONTENT_DIRECTORIES) {
      return;
    }
    setDirty(true);
    setRowErrors(new Map());
    setRows((current) => [...current, createRow()]);
  }

  function resetToFactoryDefaults(): void {
    setDirty(true);
    setRowErrors(new Map());
    setRows(
      rowsFromDirectories(LIVE_MODULE_DEFAULT_PROJECT_CONTENT_DIRECTORIES)
    );
  }

  async function onSave(): Promise<void> {
    const nextErrors = new Map<string, string>();
    const validPaths: string[] = [];
    for (const row of rows) {
      const trimmed = row.path.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const normalized = normalizeContentDirectory(trimmed);
      if (!normalized) {
        nextErrors.set(
          row.id,
          t("settings.projects.general.canvasRootsInvalidPath")
        );
        continue;
      }
      validPaths.push(normalized);
    }

    if (nextErrors.size > 0) {
      setRowErrors(nextErrors);
      return;
    }

    const contentDirectories = normalizeContentDirectoryList(validPaths);
    if (contentDirectories.length === 0) {
      setRowErrors(new Map());
      showAppAlert({
        title: t("settings.projects.general.canvasRootsSaveFailed"),
        body: t("settings.projects.general.canvasRootsNeedOne"),
      }).catch(() => undefined);
      return;
    }

    if (contentDirectories.length > LIVE_MODULE_MAX_CONTENT_DIRECTORIES) {
      showAppAlert({
        title: t("settings.projects.general.canvasRootsSaveFailed"),
        body: t("settings.projects.general.canvasRootsMaxFolders", {
          max: LIVE_MODULE_MAX_CONTENT_DIRECTORIES,
        }),
      }).catch(() => undefined);
      return;
    }

    setSaving(true);
    const result = await saveLiveModulesProjectConfig({
      projectRootPath,
      contentDirectories,
      expectedRevision: revision,
    });
    setSaving(false);

    if (result.kind === "written") {
      applyLiveModulesProjectConfigAfterSave(
        projectRootPath,
        result.contentDirectories
      );
      setRevision(result.revision);
      setRows(rowsFromDirectories(result.contentDirectories));
      setRowErrors(new Map());
      setDirty(false);
      toast.success(t("settings.projects.general.canvasRootsSaved"));
      return;
    }
    if (result.kind === "conflict") {
      showAppAlert({
        title: t("settings.projects.general.canvasRootsSaveFailed"),
        body: t("settings.projects.general.canvasRootsConflict"),
      }).catch(() => undefined);
      await reload();
      return;
    }
    showAppAlert({
      title: t("settings.projects.general.canvasRootsSaveFailed"),
      body: result.message,
    }).catch(() => undefined);
  }

  const atMaxFolders = rows.length >= LIVE_MODULE_MAX_CONTENT_DIRECTORIES;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{t("settings.projects.general.canvasRootsTitle")}</CardTitle>
        <CardDescription>
          {t("settings.projects.general.canvasRootsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {loading ? (
          <p className="text-muted-foreground text-sm">
            {t("settings.projects.general.canvasRootsLoading")}
          </p>
        ) : (
          <FieldGroup className="gap-2">
            {rows.map((row, index) => {
              const error = rowErrors.get(row.id);
              return (
                <div className="flex items-start gap-2" key={row.id}>
                  <Field
                    className="min-w-0 flex-1"
                    data-invalid={Boolean(error)}
                  >
                    <FieldLabel
                      className="sr-only"
                      htmlFor={`${baseId}-${row.id}`}
                    >
                      {t("settings.projects.general.canvasRootsPathLabel")}
                    </FieldLabel>
                    <Input
                      aria-invalid={Boolean(error)}
                      className="font-mono"
                      id={`${baseId}-${row.id}`}
                      onChange={(event) => updateRow(index, event.target.value)}
                      placeholder=".pier/canvases"
                      spellCheck={false}
                      value={row.path}
                    />
                    {error ? <FieldError>{error}</FieldError> : null}
                  </Field>
                  <Button
                    aria-label={t(
                      "settings.projects.general.canvasRootsRemove"
                    )}
                    className="mt-0"
                    disabled={saving}
                    onClick={() => removeRow(index)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </FieldGroup>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={loading || saving || atMaxFolders}
            onClick={addRow}
            type="button"
            variant="outline"
          >
            <Plus data-icon="inline-start" />
            {t("settings.projects.general.canvasRootsAdd")}
          </Button>
          <Button
            disabled={loading || saving}
            onClick={resetToFactoryDefaults}
            type="button"
            variant="outline"
          >
            <RotateCcw data-icon="inline-start" />
            {t("settings.projects.general.canvasRootsResetDefaults")}
          </Button>
        </div>
        <Button
          disabled={loading || saving || !dirty}
          onClick={() => {
            onSave().catch(() => undefined);
          }}
          type="button"
        >
          {t("settings.projects.general.canvasRootsSave")}
        </Button>
      </CardFooter>
    </Card>
  );
}
