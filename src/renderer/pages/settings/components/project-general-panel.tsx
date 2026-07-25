import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

const GIT_IGNORE_LINES = [".agents/skills/", ".claude/skills/"].join("\n");

/**
 * Project-scoped options outside the skill list: gitignore hints and removing
 * the project from Pier's index. Discovery paths live on the skill detail
 * matrix (per-skill channel checkboxes).
 */
export function ProjectGeneralPanel({
  onDelete,
}: {
  onDelete: () => void;
  /** Kept for call-site stability; skills snapshot is no longer needed here. */
  projectRootPath: string;
}) {
  const t = useT();

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.projects.general.gitIgnoreTitle")}</CardTitle>
          <CardDescription>
            {t("settings.projects.general.gitIgnoreDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
            {GIT_IGNORE_LINES}
          </pre>
          <div className="flex justify-end">
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
              size="sm"
              type="button"
              variant="outline"
            >
              {t("settings.projects.general.gitIgnoreCopy")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.projects.general.dangerTitle")}</CardTitle>
          <CardDescription>
            {t("settings.projects.general.dangerDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {t("settings.projects.general.deleteHint")}
            </p>
            <div className="flex justify-end">
              <Button onClick={onDelete} type="button" variant="destructive">
                <Trash2 data-icon="inline-start" />
                {t("settings.projects.general.deleteProject")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
