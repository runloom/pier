import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type {
  PierHomeSkillDelivery,
  PierHomeSkillView,
} from "@shared/contracts/pier-home.ts";
import type { ProjectRootRef } from "@shared/contracts/project-skills.ts";
import { useEffect, useId, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills/store.ts";

export function openBindFromLibraryDialog(
  projectRef: ProjectRootRef,
  title: string
): Promise<{ skillId: string } | null> {
  function BindFromLibraryForm({
    close,
  }: AppContentDialogRenderProps<{ skillId: string }>) {
    const t = useT();
    const claudeId = useId();
    const [candidates, setCandidates] = useState<PierHomeSkillView[] | null>(
      null
    );
    const [busyId, setBusyId] = useState<string | null>(null);
    const [alsoClaude, setAlsoClaude] = useState(false);

    useEffect(() => {
      let cancelled = false;
      Promise.all([
        window.pier.pierHomeSkills.list(),
        window.pier.pierBindings.list(projectRef),
      ])
        .then(([library, bound]) => {
          if (cancelled) return;
          const boundIds = new Set(bound.map((skill) => skill.id));
          setCandidates(
            library.filter(
              (skill) => !(skill.alwaysInclude || boundIds.has(skill.id))
            )
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          showAppAlert({
            title: t("settings.skills.bindFromLibraryFailed"),
            body: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          close(null);
        });
      return () => {
        cancelled = true;
      };
    }, [close, t]);

    if (candidates === null) {
      return <Skeleton className="h-32 w-full" />;
    }

    if (candidates.length === 0) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {t("settings.skills.bindFromLibraryEmptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {t("settings.skills.bindFromLibraryEmptyBody")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    const delivery: PierHomeSkillDelivery = {
      agents: true,
      claude: alsoClaude,
    };

    return (
      <div className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={claudeId}>
              {t("settings.skills.bindAlsoClaude")}
            </FieldLabel>
            <FieldDescription>
              {t("settings.skills.bindAlsoClaudeHint")}
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={alsoClaude}
            disabled={busyId !== null}
            id={claudeId}
            onCheckedChange={setAlsoClaude}
          />
        </Field>
        <ItemGroup className="gap-2">
          {candidates.map((skill) => (
            <Item key={skill.id} variant="outline">
              <ItemContent>
                <ItemTitle>{skill.name || skill.id}</ItemTitle>
                <ItemDescription>
                  {skill.description || skill.id}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  disabled={busyId !== null}
                  onClick={() => {
                    setBusyId(skill.id);
                    window.pier.pierBindings
                      .bind(projectRef, skill.id, delivery)
                      .then(async () => {
                        await useProjectSkillsStore
                          .getState()
                          .loadSnapshot(projectRef, { quiet: true });
                        close({ skillId: skill.id });
                      })
                      .catch((err: unknown) => {
                        showAppAlert({
                          title: t("settings.skills.bindFromLibraryFailed"),
                          body:
                            err instanceof Error ? err.message : String(err),
                        }).catch(() => undefined);
                      })
                      .finally(() => {
                        setBusyId(null);
                      });
                  }}
                  size="sm"
                  type="button"
                >
                  {t("settings.skills.bindFromLibraryAdd")}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </div>
    );
  }

  return openAppContentDialog<{ skillId: string }>({
    content: BindFromLibraryForm,
    id: "skills-bind-from-library",
    size: "default",
    title,
  }).result;
}
