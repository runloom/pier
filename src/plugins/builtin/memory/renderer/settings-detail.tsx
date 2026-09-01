import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@pier/ui/field.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { StatusStack } from "@pier/ui/status-stack.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  MEMORY_ENTITY_TYPES,
  type MemoryEntityType,
  type MemoryListResult,
  type MemoryObservationItem,
  type MemoryStatusSnapshot,
} from "@shared/contracts/agent/memory.ts";
import { FileText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  connectedMemoryAgentCount,
  formatMemoryDegradedDetails,
} from "./format-degraded-details.ts";

function entityLabel(
  t: RendererPluginContext["i18n"]["t"],
  entityType: MemoryEntityType
): string {
  return t(`entity.${entityType}`, undefined, entityType);
}

export function MemorySettingsDetail({
  context,
  projectRootPath,
}: {
  context: RendererPluginContext;
  projectRootPath: string;
}) {
  const t = context.i18n.t;
  const root = { projectRootPath, scope: "project" as const };
  const [snapshot, setSnapshot] = useState<MemoryStatusSnapshot | null>(null);
  const [list, setList] = useState<MemoryListResult | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    const nextRoot = { projectRootPath, scope: "project" as const };
    const next = await context.projectMemory.status(nextRoot);
    setSnapshot(next);
    const listed = await context.projectMemory.list(nextRoot);
    setList(listed);
  }, [context, projectRootPath]);

  useEffect(() => {
    refresh().catch((err: unknown) => {
      Promise.resolve(
        context.dialogs.alert({
          body: err instanceof Error ? err.message : String(err),
          title: t(
            "error.loadFailed",
            undefined,
            "Could not load project memory"
          ),
        })
      ).catch(() => undefined);
    });
  }, [context, refresh, t]);

  const onCheckedChange = async (checked: boolean) => {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      if (checked) {
        await context.projectMemory.enable(root);
        await refresh();
        return;
      }
      await context.projectMemory.disable(root);
      await refresh();
    } catch (err: unknown) {
      await context.dialogs.alert({
        body: err instanceof Error ? err.message : String(err),
        title: checked
          ? t(
              "error.enableFailed",
              undefined,
              "Could not turn on project memory"
            )
          : t(
              "error.disableFailed",
              undefined,
              "Could not turn off project memory"
            ),
      });
    } finally {
      setPending(false);
    }
  };

  const deleteItem = async (item: MemoryObservationItem) => {
    const ok = await context.dialogs.confirm({
      body: t(
        "confirm.delete.body",
        undefined,
        "Agents will not see this note again."
      ),
      confirmLabel: t("confirm.delete.action", undefined, "Delete"),
      intent: "destructive",
      title: t("confirm.delete.title", undefined, "Delete this memory?"),
    });
    if (!ok) {
      return;
    }
    try {
      await context.projectMemory.deleteObservation(
        root,
        item.entityName,
        item.index,
        item.observation
      );
      await refresh();
    } catch (err: unknown) {
      await context.dialogs.alert({
        body: err instanceof Error ? err.message : String(err),
        title: t("error.deleteFailed", undefined, "Could not delete memory"),
      });
    }
  };

  const openStore = (storePath: string) => {
    const splitAt = storePath.lastIndexOf("/");
    const opened =
      splitAt > 0 &&
      context.files.openInEditor({
        path: storePath.slice(splitAt + 1),
        root: storePath.slice(0, splitAt),
      });
    if (opened) {
      context.settings.close();
      return;
    }
    Promise.resolve(
      context.dialogs.alert({
        body: t(
          "error.openFailedBody",
          undefined,
          "The file panel is not available right now."
        ),
        title: t("error.openFailed", undefined, "Could not open memory file"),
      })
    ).catch(() => undefined);
  };

  const clearAll = async () => {
    const ok = await context.dialogs.confirm({
      body: t(
        "confirm.clear.body",
        undefined,
        "This only clears memory on this computer. Project memory stays on, and agent configs are unchanged."
      ),
      confirmLabel: t("confirm.clear.action", undefined, "Clear"),
      intent: "destructive",
      title: t(
        "confirm.clear.title",
        undefined,
        "Clear memory for this project?"
      ),
    });
    if (!ok) {
      return;
    }
    try {
      await context.projectMemory.clearStore(root);
      await refresh();
    } catch (err: unknown) {
      await context.dialogs.alert({
        body: err instanceof Error ? err.message : String(err),
        title: t("error.clearFailed", undefined, "Could not clear memory"),
      });
    }
  };

  const enabled = snapshot?.desiredState === "enabled";
  const degraded = snapshot?.derivedState === "degraded";
  const showEntries =
    Boolean(enabled) ||
    (list !== null && (list.tooLarge || list.items.length > 0));

  return (
    // pb-4 对齐宿主项目 tab 面板(如 ProjectGeneralPanel):给末卡下边框留出滚动余量。
    <div
      className="flex flex-col gap-4 pb-4"
      data-slot="memory-project-settings"
    >
      <Card size="sm">
        <CardContent className="flex flex-col gap-4">
          {degraded ? (
            <StatusStack
              items={[
                {
                  action: {
                    label: t("degraded.details", undefined, "View details"),
                    onClick: () => {
                      if (snapshot === null) {
                        return;
                      }
                      Promise.resolve(
                        context.dialogs.alert({
                          body: formatMemoryDegradedDetails(snapshot, t),
                          title: t(
                            "degraded.detailsTitle",
                            undefined,
                            "Connection details"
                          ),
                        })
                      ).catch(() => undefined);
                    },
                  },
                  id: "memory-degraded",
                  title: t(
                    "degraded.status",
                    undefined,
                    "Some agents are not connected."
                  ),
                  tone: "warning",
                },
              ]}
            />
          ) : null}
          <FieldSet className="gap-4">
            <Field className="!items-center" orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="pier-memory-enable">
                  {t("switch.enable", undefined, "Enable project memory")}
                </FieldLabel>
                <FieldDescription>
                  {enabled
                    ? t("summary.connected", {
                        count: snapshot
                          ? connectedMemoryAgentCount(snapshot.targets)
                          : 0,
                      })
                    : t(
                        "summary.disabledHint",
                        undefined,
                        "When on, agents remember this project's conventions, pitfalls, and decisions across sessions."
                      )}
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={enabled}
                // 快照未到前禁点:v3 默认启用,加载态误显示为「关」;此时放行
                // 点击会把一次误触写成显式决策(含 AGENTS.md 引导段)。
                disabled={pending || snapshot === null}
                id="pier-memory-enable"
                onCheckedChange={(value) => {
                  onCheckedChange(value).catch(() => undefined);
                }}
              />
            </Field>
            {snapshot ? (
              <>
                <FieldSeparator />
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-sm">
                    {t("summary.store", undefined, "Memory file location")}
                  </p>
                  <Button
                    aria-label={t(
                      "summary.openStore",
                      undefined,
                      "Open memory file in Pier"
                    )}
                    className="h-auto min-w-0 justify-start whitespace-normal px-0 py-0 text-left"
                    onClick={() => {
                      openStore(snapshot.storePath);
                    }}
                    title={snapshot.storePath}
                    type="button"
                    variant="link"
                  >
                    <span className="break-all font-mono">
                      {snapshot.storePathDisplay}
                    </span>
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-muted-foreground text-sm">
                    {t("summary.engine", undefined, "Engine version")}
                  </p>
                  <p className="break-all font-mono text-sm">
                    {snapshot.enginePackage}
                  </p>
                </div>
              </>
            ) : null}
            <p className="text-muted-foreground text-sm">
              {t(
                "summary.newSessionNote",
                undefined,
                "Changes apply to newly started agent sessions."
              )}
            </p>
            {enabled ? (
              <p className="text-muted-foreground text-sm">
                {t(
                  "first.claudeTrust",
                  undefined,
                  "Claude Code asks one-time approval for project memory tools on first use."
                )}
              </p>
            ) : null}
          </FieldSet>
        </CardContent>
      </Card>
      {showEntries ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("entries.title", undefined, "Memories")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <EntriesBody
              list={list}
              onClear={() => {
                clearAll().catch(() => undefined);
              }}
              onDelete={(item) => {
                deleteItem(item).catch(() => undefined);
              }}
              t={t}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function EntriesBody({
  list,
  onClear,
  onDelete,
  t,
}: {
  list: MemoryListResult | null;
  onClear: () => void;
  onDelete: (item: MemoryObservationItem) => void;
  t: RendererPluginContext["i18n"]["t"];
}) {
  if (list?.tooLarge) {
    return (
      <p className="text-muted-foreground text-sm">
        {t(
          "empty.tooLarge",
          undefined,
          "The memory file is too large to list or delete here."
        )}
      </p>
    );
  }
  if (list && list.items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>
            {t("empty.noEntries", undefined, "No memories yet")}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              "empty.noEntriesHint",
              undefined,
              "Notes agents save in a session will show up here."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <>
      {MEMORY_ENTITY_TYPES.map((entityType) => {
        const rows =
          list?.items.filter((item) => item.entityType === entityType) ?? [];
        if (rows.length === 0) {
          return null;
        }
        return (
          <div className="flex flex-col gap-2" key={entityType}>
            <FieldLegend>{entityLabel(t, entityType)}</FieldLegend>
            <ItemGroup className="gap-2">
              {rows.map((item) => (
                <Item
                  key={`${item.entityType}:${item.entityName}:${item.index}:${item.observation}`}
                  size="sm"
                  variant="outline"
                >
                  <ItemContent>
                    <ItemTitle>{item.observation}</ItemTitle>
                    <ItemDescription className="text-xs">
                      {item.entityName} · {entityLabel(t, item.entityType)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      aria-label={t(
                        "delete.aria",
                        undefined,
                        "Delete this memory"
                      )}
                      onClick={() => {
                        onDelete(item);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </div>
        );
      })}
      <Button
        className="self-start"
        onClick={onClear}
        type="button"
        variant="destructive"
      >
        <Trash2 data-icon="inline-start" />
        {t("clear.action", undefined, "Clear project memory")}
      </Button>
    </>
  );
}
