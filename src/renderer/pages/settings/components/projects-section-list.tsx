import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { ChevronRight, Folder, FolderPlus } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import type { ProjectSkillsProjectSummary } from "@/stores/project-skills.store.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function projectBasename(projectRootPath: string): string {
  return (
    projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    projectRootPath
  );
}

export function ProjectsSectionList({
  activeProjectRootPath,
  onAddProject,
  onOpenProject,
  projects,
  skillsProjects,
}: {
  activeProjectRootPath: string | null;
  onAddProject: () => void;
  onOpenProject: (projectRootPath: string) => void;
  projects: readonly { projectRootPath: string }[];
  skillsProjects: readonly ProjectSkillsProjectSummary[];
}) {
  const t = useT();
  const sorted = [...projects].sort((a, b) => {
    const aCurrent = a.projectRootPath === activeProjectRootPath ? 0 : 1;
    const bCurrent = b.projectRootPath === activeProjectRootPath ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return a.projectRootPath.localeCompare(b.projectRootPath);
  });

  return (
    <div className="px-4 pb-4" id="projects">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl">{t("settings.section.projects")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("settings.projects.description")}
          </p>
        </div>
        <Button
          onClick={() => {
            onAddProject();
          }}
          size="sm"
          type="button"
        >
          <FolderPlus data-icon="inline-start" />
          {t("settings.projects.addProject")}
        </Button>
      </div>
      <ItemGroup>
        {sorted.map((project) => {
          const isCurrent = project.projectRootPath === activeProjectRootPath;
          const skillsSummary = skillsProjects.find(
            (entry) => entry.projectRef.realPath === project.projectRootPath
          );
          let trailing: string | null = null;
          if (skillsSummary != null) {
            if (
              skillsSummary.readStatus === "ok" ||
              skillsSummary.readStatus === "missing-manifest"
            ) {
              trailing = t("settings.skills.skillCount", {
                count: skillsSummary.skillCount,
              });
            } else {
              trailing = t("settings.skills.loadFailed");
            }
          }
          return (
            <Item
              key={project.projectRootPath}
              onClick={() => {
                onOpenProject(project.projectRootPath);
              }}
              role="button"
              tabIndex={0}
              variant="outline"
            >
              <ItemMedia variant="icon">
                <Folder />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">
                  <span className="truncate">
                    {projectBasename(project.projectRootPath)}
                  </span>
                  {isCurrent ? (
                    <Badge variant="secondary">
                      {t("settings.skills.currentBadge")}
                    </Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription className="truncate font-mono">
                  {project.projectRootPath}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {trailing ? (
                  <span className="text-muted-foreground text-xs">
                    {trailing}
                  </span>
                ) : null}
                <ChevronRight className="size-4 text-muted-foreground" />
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </div>
  );
}
