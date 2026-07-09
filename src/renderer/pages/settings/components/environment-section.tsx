import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
import {
  EnvironmentEditor,
  type EnvironmentEditorHandle,
} from "./environment-editor.tsx";

const PATH_SEPARATOR_RE = /[\\/]/;
function projectBasename(projectRootPath: string): string {
  return (
    projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    projectRootPath
  );
}

export function EnvironmentSection() {
  const t = useT();
  const projects = useLocalEnvironmentsStore((s) => s.projects);
  const worktreeBindings = useLocalEnvironmentsStore((s) => s.worktreeBindings);
  const addProject = useLocalEnvironmentsStore((s) => s.addProject);
  const removeProject = useLocalEnvironmentsStore((s) => s.removeProject);
  const activeProjectRootPath =
    useActiveDescriptor()?.context?.projectRootPath ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [initializedFromActive, setInitializedFromActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<EnvironmentEditorHandle | null>(null);

  useEffect(() => {
    if (initializedFromActive) {
      return;
    }
    if (!activeProjectRootPath) {
      return;
    }
    if (projects.some((p) => p.projectRootPath === activeProjectRootPath)) {
      setSelected(activeProjectRootPath);
      setInitializedFromActive(true);
    }
  }, [activeProjectRootPath, initializedFromActive, projects]);

  useEffect(() => {
    if (selected && !projects.some((p) => p.projectRootPath === selected)) {
      setSelected(null);
    }
  }, [selected, projects]);

  const focused: LocalEnvironmentProject | null = selected
    ? (projects.find((p) => p.projectRootPath === selected) ?? null)
    : null;

  async function guardDirty(): Promise<boolean> {
    if (!(dirty && focused)) {
      return true;
    }
    return await showAppConfirm({
      body: t("settings.environment.discardBody", {
        name: projectBasename(focused.projectRootPath),
      }),
      intent: "destructive",
      size: "sm",
      title: t("settings.environment.discardTitle"),
    });
  }

  async function goBack(): Promise<void> {
    if (!(await guardDirty())) {
      return;
    }
    setSelected(null);
  }

  function openProject(projectRootPath: string): void {
    setSelected(projectRootPath);
  }

  async function addEnvironment(): Promise<void> {
    try {
      const dir = await window.pier.environments.pickProjectDirectory();
      if (!dir) {
        return;
      }
      if (!(await guardDirty())) {
        return;
      }
      await addProject({ projectRootPath: dir });
      setSelected(dir);
    } catch (err) {
      console.error("[environment-section] addEnvironment failed:", err);
      await showAppAlert({
        title: t("settings.environment.addFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function requestDelete(): Promise<void> {
    if (!focused) {
      return;
    }
    const name = projectBasename(focused.projectRootPath);
    const boundCount = worktreeBindings.filter(
      (b) => b.projectRootPath === focused.projectRootPath
    ).length;
    const confirmed = await showAppConfirm({
      body:
        boundCount > 0
          ? t("settings.environment.deleteConfirmBoundBody", {
              count: boundCount,
              name,
            })
          : t("settings.environment.deleteConfirmBody", { name }),
      intent: "destructive",
      size: "sm",
      title: t("settings.environment.deleteConfirmTitle"),
    });
    if (!confirmed) {
      return;
    }
    try {
      await removeProject({ projectRootPath: focused.projectRootPath });
      setSelected(null);
    } catch (err) {
      console.error("[environment-section] delete failed:", err);
      await showAppAlert({
        title: t("settings.environment.deleteFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function triggerSave(): Promise<void> {
    try {
      await editorRef.current?.save();
      toast.success(t("settings.environment.saveSuccess"));
    } catch (err) {
      await showAppAlert({
        title: t("settings.environment.saveFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sectionHeader = (
    <h1 className="text-xl">{t("settings.section.environment")}</h1>
  );

  if (projects.length === 0) {
    return (
      <div className="px-4 pb-4" id="environment">
        <div className="mb-4">{sectionHeader}</div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlus />
            </EmptyMedia>
            <EmptyTitle>{t("settings.environment.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("settings.environment.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                addEnvironment().catch(() => {
                  // handled inside addEnvironment
                });
              }}
              size="sm"
              type="button"
            >
              <FolderPlus />
              {t("settings.environment.addEnvironment")}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (focused) {
    return (
      <div className="px-4 pb-4" id="environment">
        <TooltipProvider delayDuration={0} disableHoverableContent>
          <div className="mb-4 flex items-center gap-3">
            <Button
              aria-label={t("settings.environment.back")}
              onClick={() => {
                goBack().catch(() => {
                  // handled inside goBack
                });
              }}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft />
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h1 className="truncate text-xl">
                {projectBasename(focused.projectRootPath)}
              </h1>
              <span className="truncate text-muted-foreground text-xs">
                {focused.projectRootPath}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("settings.environment.deleteProject")}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      requestDelete().catch(() => {
                        // handled inside requestDelete
                      });
                    }}
                    size="icon-lg"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.environment.deleteProject")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("settings.environment.save")}
                    disabled={!dirty}
                    onClick={() => {
                      triggerSave().catch(() => {
                        // handled inside triggerSave
                      });
                    }}
                    size="icon-lg"
                    type="button"
                  >
                    <Check />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.environment.save")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
        <EnvironmentEditor
          key={focused.projectRootPath}
          onDirtyChange={setDirty}
          project={focused}
          ref={editorRef}
        />
      </div>
    );
  }

  return (
    <div className="px-4 pb-4" id="environment">
      <div className="mb-4 flex items-center justify-between gap-3">
        {sectionHeader}
        <Button
          onClick={() => {
            addEnvironment().catch(() => {
              // handled inside addEnvironment
            });
          }}
          type="button"
        >
          <Plus />
          {t("settings.environment.addEnvironment")}
        </Button>
      </div>
      <ItemGroup>
        {projects.map((p) => (
          <Item asChild key={p.projectRootPath} variant="outline">
            <button
              className="cursor-pointer text-left hover:bg-muted"
              onClick={() => {
                openProject(p.projectRootPath);
              }}
              type="button"
            >
              <ItemMedia variant="icon">
                <Folder />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{projectBasename(p.projectRootPath)}</ItemTitle>
                <ItemDescription>{p.projectRootPath}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRight className="size-4 text-muted-foreground" />
              </ItemActions>
            </button>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}
