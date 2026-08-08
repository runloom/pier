import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { ProjectCanvasRootsCard } from "./canvas-roots-card.tsx";

const GIT_IGNORE_LINES = [".agents/skills/", ".claude/skills/"].join("\n");

/**
 * Project → General: workspace prefs (canvas roots, gitignore) then danger zone.
 */
export function ProjectGeneralPanel({
  onDelete,
  projectRootPath,
}: {
  onDelete: () => void;
  projectRootPath: string;
}) {
  const t = useT();

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-4">
      <div className="flex min-w-0 flex-col gap-4">
        <ProjectCanvasRootsCard projectRootPath={projectRootPath} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>
              {t("settings.projects.general.gitIgnoreTitle")}
            </CardTitle>
            <CardDescription>
              {t("settings.projects.general.gitIgnoreDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3">
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed">
              {GIT_IGNORE_LINES}
            </pre>
          </CardContent>
          <CardFooter className="justify-end border-t pt-3">
            <Button
              onClick={() => {
                navigator.clipboard
                  .writeText(GIT_IGNORE_LINES)
                  .then(() => {
                    toast.success(
                      t("settings.projects.general.gitIgnoreCopied")
                    );
                  })
                  .catch(() => {
                    showAppAlert({
                      title: t("settings.skills.copyFailed"),
                      body: t("settings.skills.copyFailed"),
                    }).catch(() => undefined);
                  });
              }}
              type="button"
              variant="outline"
            >
              <Copy data-icon="inline-start" />
              {t("settings.projects.general.gitIgnoreCopy")}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <Separator />
        <Card className="border-destructive/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-destructive">
              {t("settings.projects.general.dangerTitle")}
            </CardTitle>
            <CardDescription>
              {t("settings.projects.general.dangerDescription")}
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-end border-t pt-3">
            <Button onClick={onDelete} type="button" variant="destructive">
              <Trash2 data-icon="inline-start" />
              {t("settings.projects.general.deleteProject")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
