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
import { ChevronRight, Folder, FolderPlus, House } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import type { ProjectSkillsProjectSummary } from "@/stores/project-skills/store.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function projectBasename(projectRootPath: string): string {
  return (
    projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    projectRootPath
  );
}

interface ProjectListEntry {
  kind?: "project" | "pier-home";
  projectRootPath: string;
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
  projects: readonly ProjectListEntry[];
  skillsProjects: readonly ProjectSkillsProjectSummary[];
}) {
  const t = useT();
  const sorted = [...projects].sort((a, b) => {
    // User projects first; Pier Home stays at the bottom as a fixed host entry.
    const aHome = a.kind === "pier-home" ? 1 : 0;
    const bHome = b.kind === "pier-home" ? 1 : 0;
    if (aHome !== bHome) return aHome - bHome;
    const aCurrent = a.projectRootPath === activeProjectRootPath ? 0 : 1;
    const bCurrent = b.projectRootPath === activeProjectRootPath ? 0 : 1;
    if (aCurrent !== bCurrent) return aCurrent - bCurrent;
    return a.projectRootPath.localeCompare(b.projectRootPath);
  });

  const hasUserProjects = projects.some((p) => p.kind !== "pier-home");

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
      {hasUserProjects ? null : (
        <p className="mb-3 text-muted-foreground text-sm">
          {t("settings.projects.emptyDescription")}
        </p>
      )}
      <ItemGroup>
        {sorted.map((project) => {
          const isHome = project.kind === "pier-home";
          const isCurrent =
            !isHome && project.projectRootPath === activeProjectRootPath;
          const skillsSummary = skillsProjects.find(
            (entry) => entry.projectRef.realPath === project.projectRootPath
          );
          let trailing: string | null = null;
          if (!isHome && skillsSummary != null) {
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
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpenProject(project.projectRootPath);
              }}
              role="button"
              tabIndex={0}
              variant="outline"
            >
              <ItemMedia variant="icon">
                {isHome ? <House /> : <Folder />}
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">
                  <span className="truncate">
                    {isHome
                      ? t("settings.projects.pierHomeTitle")
                      : projectBasename(project.projectRootPath)}
                  </span>
                  {isHome ? (
                    <Badge variant="secondary">
                      {t("settings.projects.pierHomeBadge")}
                    </Badge>
                  ) : null}
                  {isCurrent ? (
                    <Badge variant="secondary">
                      {t("settings.skills.currentBadge")}
                    </Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription
                  className={isHome ? "truncate" : "truncate font-mono"}
                >
                  {isHome
                    ? t("settings.projects.pierHomePathHint")
                    : project.projectRootPath}
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
