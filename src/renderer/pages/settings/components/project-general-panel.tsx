import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  emptyDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { SwitchRow } from "./rows/switch-row.tsx";
import { commitSkillsIntent } from "./skills/skills-apply-flow.ts";
import { confirmDiscardSkillEditDrafts } from "./skills/skills-shared.tsx";

const GIT_IGNORE_LINES = [".agents/skills/", ".claude/skills/"].join("\n");

/**
 * Project-scoped options that are neither environment scripts nor the skill
 * list: delivery targets and removing the project from the shared index.
 */
export function ProjectGeneralPanel({
  onDelete,
  projectRootPath,
}: {
  onDelete: () => void;
  projectRootPath: string;
}) {
  const t = useT();
  const snapshot = useProjectSkillsStore((s) => s.snapshot);
  const projectRef = useProjectSkillsStore((s) => s.projectRef);
  const writesFrozen = useProjectSkillsStore((s) => s.writesFrozen);
  const applyPending = useProjectSkillsStore((s) => s.applyPending);
  const planPending = useProjectSkillsStore((s) => s.planPending);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function pin() {
      const api = window.pier?.projectSkills;
      if (!api) {
        if (!cancelled) setReady(true);
        return;
      }
      const state = useProjectSkillsStore.getState();
      if (state.projectRef?.realPath === projectRootPath && state.snapshot) {
        if (!cancelled) setReady(true);
        return;
      }
      const match = state.projects.find(
        (p) => p.projectRef.realPath === projectRootPath
      );
      if (match) {
        if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) return;
        state.selectProject(match.projectRef);
        await useProjectSkillsStore.getState().loadSnapshot(match.projectRef);
        if (!cancelled) setReady(true);
        return;
      }
      const resolved = await state.loadProjects(projectRootPath);
      if (cancelled || !resolved) {
        if (!cancelled) setReady(true);
        return;
      }
      if (!(await confirmDiscardSkillEditDrafts(t)) || cancelled) return;
      useProjectSkillsStore.getState().selectProject(resolved);
      await useProjectSkillsStore.getState().loadSnapshot(resolved);
      if (!cancelled) setReady(true);
    }
    setReady(false);
    pin().catch(async (err) => {
      if (cancelled) return;
      setReady(true);
      await showAppAlert({
        title: t("settings.skills.loadFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [projectRootPath, t]);

  const baselineAgents = Boolean(snapshot?.manifest?.delivery?.agents);
  const baselineClaude = Boolean(snapshot?.manifest?.delivery?.claude);
  const writesDisabled =
    !(ready && projectRef) ||
    projectRef.realPath !== projectRootPath ||
    writesFrozen ||
    applyPending ||
    planPending;

  function commitDelivery(next: { agents: boolean; claude: boolean }) {
    const intent = emptyDraft(next);
    commitSkillsIntent({
      draft: intent,
      t,
    }).catch(() => undefined);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.projects.general.deliveryTitle")}</CardTitle>
          <CardDescription>
            {t("settings.projects.general.deliveryDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SwitchRow
            checked={baselineAgents}
            description={t("settings.projects.general.deliveryAgentsHint")}
            disabled={writesDisabled}
            id="projects-delivery-agents"
            label={t("settings.projects.general.deliveryAgents")}
            onCheckedChange={(checked) => {
              commitDelivery({ agents: checked, claude: baselineClaude });
            }}
          />
          <SwitchRow
            checked={baselineClaude}
            description={t("settings.projects.general.deliveryClaudeHint")}
            disabled={writesDisabled}
            id="projects-delivery-claude"
            label={t("settings.projects.general.deliveryClaude")}
            onCheckedChange={(checked) => {
              commitDelivery({ agents: baselineAgents, claude: checked });
            }}
          />
        </CardContent>
      </Card>

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
