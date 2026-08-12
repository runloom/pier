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
  PierHomeSystemSkillView,
  PierHomeUserGlobalSkillView,
} from "@shared/contracts/pier-home.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { openPierHomeCreateSkillDialog } from "./pier-home-create-skill-dialog.tsx";
import {
  forceClosePierHomeLibrarySkillDialog,
  isPierHomeLibrarySkillDialogDirty,
  openPierHomeLibrarySkillDialog,
} from "./pier-home-skill-detail.tsx";
import { pierHomeSystemProviderLabel } from "./pier-home-system-provider-label.ts";
import { openPierHomeSystemSkillDialog } from "./pier-home-system-skill-dialog.tsx";
import { openPierHomeUserGlobalSkillDialog } from "./pier-home-user-global-skill-dialog.tsx";
import { AgentEffectSummary, type Translate } from "./skills/shared.tsx";

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
    title: t("settings.skills.leaveEditTitle"),
  });
  if (!ok) return false;
  forceClosePierHomeLibrarySkillDialog();
  return true;
}

type HomeSkillRow =
  | { kind: "system"; skill: PierHomeSystemSkillView }
  | { kind: "library"; skill: PierHomeSkillView }
  | { kind: "user-global"; skill: PierHomeUserGlobalSkillView };

function rowLabel(row: HomeSkillRow): string {
  if (row.kind === "system") {
    return row.skill.name || row.skill.id;
  }
  if (row.kind === "library") {
    return row.skill.name || row.skill.id;
  }
  return row.skill.name || row.skill.directoryName;
}

function rowKey(row: HomeSkillRow): string {
  if (row.kind === "system") {
    return `system:${row.skill.id}`;
  }
  if (row.kind === "library") {
    return `library:${row.skill.id}`;
  }
  return `user-global:${row.skill.root}/${row.skill.directoryName}`;
}

/**
 * Pier Home skills tab: flat list with type badges (system / library /
 * agent-global). System and agent-global open read-only; library is editable.
 */
export function PierHomeSkillsPanel() {
  const t = useT();
  const [library, setLibrary] = useState<PierHomeSkillView[]>([]);
  const [systemSkills, setSystemSkills] = useState<PierHomeSystemSkillView[]>(
    []
  );
  const [userGlobal, setUserGlobal] = useState<PierHomeUserGlobalSkillView[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const snap = await window.pier.pierHomeSkills.snapshot();
    setLibrary(snap.library);
    setSystemSkills(snap.systemSkills ?? []);
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

  const rows = useMemo((): HomeSkillRow[] => {
    const next: HomeSkillRow[] = [
      ...systemSkills.map((skill) => ({ kind: "system" as const, skill })),
      ...library.map((skill) => ({ kind: "library" as const, skill })),
      ...userGlobal.map((skill) => ({ kind: "user-global" as const, skill })),
    ];
    next.sort((a, b) =>
      rowLabel(a).localeCompare(rowLabel(b), undefined, {
        sensitivity: "base",
      })
    );
    return next;
  }, [library, systemSkills, userGlobal]);

  async function openLibrary(skill: PierHomeSkillView): Promise<void> {
    await openPierHomeLibrarySkillDialog(skill);
    await reload().catch(() => undefined);
  }

  async function openRow(row: HomeSkillRow): Promise<void> {
    if (row.kind === "system") {
      await openPierHomeSystemSkillDialog(row.skill);
      return;
    }
    if (row.kind === "library") {
      await openLibrary(row.skill);
      return;
    }
    await openPierHomeUserGlobalSkillDialog(row.skill);
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {t("settings.projects.pierHomeSkillsListTitle")}
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {t("settings.projects.pierHomeSkillsListDescription")}
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              createSkill().catch(() => undefined);
            }}
            type="button"
          >
            {t("settings.projects.pierHomeLibraryAdd")}
          </Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t("settings.projects.pierHomeSkillsListEmptyTitle")}
                </EmptyTitle>
                <EmptyDescription>
                  {t("settings.projects.pierHomeSkillsListEmptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {rows.map((row) => (
                <Item key={rowKey(row)} variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {rowLabel(row)}
                      {row.kind === "system" ? (
                        <Badge variant="secondary">
                          {t("settings.projects.pierHomeSystemBadge")}
                        </Badge>
                      ) : null}
                      {row.kind === "library" ? (
                        <Badge variant="secondary">
                          {t("settings.skills.pierLibraryBadge")}
                        </Badge>
                      ) : null}
                      {row.kind === "user-global" ? (
                        <Badge variant="outline">
                          {t("settings.skills.userGlobalBadge")}
                        </Badge>
                      ) : null}
                      {row.kind === "library" && row.skill.alwaysInclude ? (
                        <Badge variant="outline">
                          {t("settings.skills.alwaysIncludeBadge")}
                        </Badge>
                      ) : null}
                    </ItemTitle>
                    {row.kind === "system" ? (
                      <>
                        <ItemDescription>
                          {row.skill.description || row.skill.id}
                        </ItemDescription>
                        <ItemDescription className="text-xs">
                          {t("settings.projects.pierHomeSystemProvider", {
                            provider: pierHomeSystemProviderLabel(
                              row.skill.providerId,
                              t
                            ),
                            version: row.skill.providerVersion,
                          })}
                        </ItemDescription>
                      </>
                    ) : null}
                    {row.kind === "library" ? (
                      <ItemDescription>
                        {row.skill.description || row.skill.id}
                      </ItemDescription>
                    ) : null}
                    {row.kind === "user-global" ? (
                      <>
                        <ItemDescription>
                          <span className="font-mono">
                            {`${row.skill.root}/${row.skill.directoryName}`}
                          </span>
                        </ItemDescription>
                        {row.skill.description ? (
                          <ItemDescription>
                            {row.skill.description}
                          </ItemDescription>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          <AgentEffectSummary
                            effects={row.skill.effects}
                            t={t}
                          />
                        </div>
                      </>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        openRow(row).catch(() => undefined);
                      }}
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
