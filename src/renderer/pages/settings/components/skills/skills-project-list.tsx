import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
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
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { ChevronRight, Folder, FolderPlus } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import type { ProjectSkillsProjectSummary } from "@/stores/project-skills.store.ts";
import { projectBasename } from "./skills-shared.tsx";

/**
 * Project list (design v8 §7.2): shared local project index + current panel
 * project pinned first. Rows show name / path / managed skill count only —
 * health lives in the detail view. No remove action here (project registry
 * lifecycle stays in the environment section).
 */
export function SkillsProjectList({
  projects,
  loading,
  loadFailed,
  activeProjectRootPath,
  onOpenProject,
  onProjectsChanged,
}: {
  projects: ProjectSkillsProjectSummary[];
  loading: boolean;
  loadFailed: boolean;
  activeProjectRootPath: string | null;
  onOpenProject: (project: ProjectSkillsProjectSummary) => void;
  onProjectsChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const addProject = useLocalEnvironmentsStore((s) => s.addProject);
  const [addPending, setAddPending] = useState(false);
  const addRequestRef = useRef(0);

  async function handleAddProject() {
    if (addPending) return;
    const requestId = addRequestRef.current + 1;
    addRequestRef.current = requestId;
    setAddPending(true);
    try {
      const dir = await window.pier.environments.pickProjectDirectory();
      if (!dir || addRequestRef.current !== requestId) {
        return;
      }
      await addProject({ projectRootPath: dir });
      if (addRequestRef.current === requestId) {
        await onProjectsChanged();
      }
    } catch {
      if (addRequestRef.current === requestId) {
        await showAppAlert({
          title: t("settings.skills.addProjectFailed"),
          body: t("settings.skills.addProjectFailedBody"),
        });
      }
    } finally {
      if (addRequestRef.current === requestId) {
        setAddPending(false);
      }
    }
  }

  const sorted = [...projects].sort((a, b) => {
    const aCurrent = a.projectRef.realPath === activeProjectRootPath ? 0 : 1;
    const bCurrent = b.projectRef.realPath === activeProjectRootPath ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return a.displayPath.localeCompare(b.displayPath);
  });
  const loadWarning = (
    <Card>
      <CardContent>
        <Alert variant="destructive">
          <AlertTitle>{t("settings.skills.projectsLoadFailed")}</AlertTitle>
          <AlertDescription>
            <span className="flex flex-col gap-2">
              {t("settings.skills.projectsLoadFailedBody")}
              <span className="flex justify-end">
                <Button
                  disabled={loading}
                  onClick={() => {
                    onProjectsChanged().catch(() => undefined);
                  }}
                  size="sm"
                  type="button"
                >
                  {t("settings.skills.retry")}
                </Button>
              </span>
            </span>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );

  if (loading && projects.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (loadFailed && sorted.length === 0) {
    return loadWarning;
  }

  if (sorted.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderPlus data-icon="inline-start" />
          </EmptyMedia>
          <EmptyTitle>{t("settings.skills.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("settings.skills.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            disabled={addPending}
            onClick={() => {
              handleAddProject().catch(() => undefined);
            }}
            type="button"
          >
            <FolderPlus data-icon="inline-start" />
            {t("settings.skills.addProject")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {loadFailed ? loadWarning : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-sm">
          {t("settings.skills.projectsTitle")}
        </h2>
        <Button
          disabled={addPending}
          onClick={() => {
            handleAddProject().catch(() => undefined);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <FolderPlus data-icon="inline-start" />
          {t("settings.skills.addProject")}
        </Button>
      </div>
      <ItemGroup>
        {sorted.map((project) => {
          const pathValue = project.projectRef.realPath;
          const isCurrent = pathValue === activeProjectRootPath;
          return (
            <li
              key={`${project.projectRef.volumeIdentity}:${project.projectRef.directoryIdentity}`}
            >
              <Item asChild variant="outline">
                <button
                  className="w-full text-left"
                  onClick={() => {
                    onOpenProject(project);
                  }}
                  type="button"
                >
                  <ItemMedia variant="icon">
                    <Folder />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {projectBasename(pathValue)}
                      {isCurrent ? (
                        <Badge variant="secondary">
                          {t("settings.skills.currentBadge")}
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription>
                      <span className="font-mono">{pathValue}</span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <span className="text-muted-foreground text-xs">
                      {project.readStatus === "ok" ||
                      project.readStatus === "missing-manifest"
                        ? t("settings.skills.skillCount", {
                            count: project.skillCount,
                          })
                        : t("settings.skills.loadFailed")}
                    </span>
                    <ChevronRight className="text-muted-foreground" />
                  </ItemActions>
                </button>
              </Item>
            </li>
          );
        })}
      </ItemGroup>
    </div>
  );
}
