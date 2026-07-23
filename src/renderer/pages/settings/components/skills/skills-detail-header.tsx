import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import { ArrowLeft } from "lucide-react";
import { SkillsAddMenu } from "./skills-add-menu.tsx";
import { projectBasename, type Translate } from "./skills-shared.tsx";

/** Project-detail header (split for file-size cap). */

export function SkillsDetailHeader({
  projectRef,
  activeProjectRootPath,
  addDisabled,
  hideBack = false,
  t,
  onBack,
}: {
  projectRef: ProjectRootRef;
  activeProjectRootPath: string | null;
  addDisabled: boolean;
  hideBack?: boolean;
  t: Translate;
  onBack: () => void;
}) {
  if (hideBack) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Button
        aria-label={t("settings.skills.backToList")}
        onClick={onBack}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowLeft data-icon="inline-start" />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-lg" tabIndex={-1}>
          {projectBasename(projectRef.realPath)}
          {projectRef.realPath === activeProjectRootPath ? (
            <Badge className="ml-2" variant="secondary">
              {t("settings.skills.currentBadge")}
            </Badge>
          ) : null}
        </h2>
        <span className="truncate font-mono text-muted-foreground text-xs">
          {projectRef.realPath}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SkillsAddMenu disabled={addDisabled} />
      </div>
    </div>
  );
}
