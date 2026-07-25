import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type {
  PierHomeSkillView,
  PierHomeUserGlobalSkillView,
} from "@shared/contracts/pier-home.ts";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { openPierHomeCreateSkillDialog } from "./pier-home-create-skill-dialog.tsx";
import {
  forceClosePierHomeLibrarySkillDialog,
  isPierHomeLibrarySkillDialogDirty,
  openPierHomeLibrarySkillDialog,
} from "./pier-home-skill-detail.tsx";
import { openPierHomeUserGlobalSkillDialog } from "./pier-home-user-global-skill-dialog.tsx";
import { AgentEffectSummary, type Translate } from "./skills/skills-shared.tsx";

export function isPierHomeSkillsDirty(): boolean {
  return isPierHomeLibrarySkillDialogDirty();
}

/** Projects shell leave guard: discard Home library edits before leaving. */
export async function leavePierHomeSkillsTransientState(
  t: Translate
): Promise<boolean> {
  if (!isPierHomeLibrarySkillDialogDirty()) return true;
  const ok = await showAppConfirm({
    body: t("settings.skills.leaveEditBody"),
    intent: "destructive",
    size: "sm",
    title: t("settings.skills.leaveEditTitle"),
  });
  if (!ok) return false;
  forceClosePierHomeLibrarySkillDialog();
  return true;
}

/**
 * Pier Home skills tab: agent-global RO + Pier-owned library CRUD (IA v5).
 * Open / edit both use secondary content dialogs (CodeMirror) over the list.
 */
export function PierHomeSkillsPanel() {
  const t = useT();
  const [library, setLibrary] = useState<PierHomeSkillView[]>([]);
  const [userGlobal, setUserGlobal] = useState<PierHomeUserGlobalSkillView[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const snap = await window.pier.pierHomeSkills.snapshot();
    setLibrary(snap.library);
    setUserGlobal(snap.userGlobal);
    return snap;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err: unknown) => {
        if (cancelled) return;
        showAppAlert({
          title: t("settings.projects.pierHomeSkillsLoadFailed"),
          body: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  async function openLibrary(skill: PierHomeSkillView): Promise<void> {
    await openPierHomeLibrarySkillDialog(skill);
    await reload().catch(() => undefined);
  }

  async function createSkill(): Promise<void> {
    setBusy(true);
    try {
      const created = await openPierHomeCreateSkillDialog(
        library.map((skill) => skill.id)
      );
      if (created) {
        await reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {t("settings.projects.pierHomeLibraryTitle")}
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("settings.projects.pierHomeLibraryDescription")}
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              createSkill().catch(() => undefined);
            }}
            size="sm"
            type="button"
          >
            {t("settings.projects.pierHomeLibraryAdd")}
          </Button>
        </CardHeader>
        <CardContent>
          {library.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t("settings.projects.pierHomeLibraryEmptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("settings.projects.pierHomeLibraryEmptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {library.map((skill) => (
                <Item key={skill.id} variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {skill.name || skill.id}
                      <Badge variant="secondary">
                        {t("settings.skills.pierLibraryBadge")}
                      </Badge>
                      {skill.alwaysInclude ? (
                        <Badge variant="outline">
                          {t("settings.skills.alwaysIncludeBadge")}
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    <ItemDescription>
                      {skill.description || skill.id}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        openLibrary(skill).catch(() => undefined);
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("settings.skills.open")}
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.projects.pierHomeGlobalTitle")}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {t("settings.projects.pierHomeGlobalDescription")}
          </p>
        </CardHeader>
        <CardContent>
          {userGlobal.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t("settings.projects.pierHomeGlobalEmptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("settings.projects.pierHomeGlobalEmptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {userGlobal.map((entry) => (
                <Item
                  className="border-dashed"
                  key={`${entry.root}/${entry.directoryName}`}
                  variant="outline"
                >
                  <ItemContent>
                    <ItemTitle>
                      {entry.name || entry.directoryName}
                      <Badge variant="outline">
                        {t("settings.skills.userGlobalBadge")}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>
                      <span className="font-mono">
                        {`${entry.root}/${entry.directoryName}`}
                      </span>
                    </ItemDescription>
                    {entry.description ? (
                      <ItemDescription>{entry.description}</ItemDescription>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      <AgentEffectSummary effects={entry.effects} t={t} />
                    </div>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        openPierHomeUserGlobalSkillDialog(entry).catch(
                          () => undefined
                        );
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("settings.skills.open")}
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
