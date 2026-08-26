import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Label } from "@pier/ui/label.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { MemoryStatusSnapshot } from "@shared/contracts/memory.ts";
import { useCallback, useEffect, useState } from "react";

function projectRootFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const context = params.context;
  if (
    !context ||
    typeof context !== "object" ||
    !("projectRootPath" in context)
  ) {
    return;
  }
  const path = context.projectRootPath;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function connectedAgentCount(snapshot: MemoryStatusSnapshot): number {
  const names = new Set<string>();
  for (const row of snapshot.targets) {
    if (row.outcome !== "written") {
      continue;
    }
    for (const consumer of row.consumers) {
      names.add(consumer);
    }
  }
  return names.size;
}

export function createMemoryPanel(context: RendererPluginContext) {
  return function MemoryPanel(props: IDockviewPanelProps) {
    const projectRootPath = projectRootFromParams(props.params);
    const [snapshot, setSnapshot] = useState<MemoryStatusSnapshot | null>(null);
    const [pending, setPending] = useState(false);
    const t = context.i18n.t;

    const refresh = useCallback(async () => {
      if (!projectRootPath) {
        setSnapshot(null);
        return;
      }
      const next = await context.projectMemory.status({
        projectRootPath,
        scope: "project",
      });
      setSnapshot(next);
    }, [projectRootPath]);

    useEffect(() => {
      refresh().catch((err: unknown) => {
        context.dialogs
          .alert({
            body: err instanceof Error ? err.message : String(err),
            title: t("state.degraded", undefined, "Partially connected"),
          })
          .catch(() => undefined);
      });
    }, [refresh, t]);

    const onCheckedChange = async (checked: boolean) => {
      if (!projectRootPath || pending) {
        return;
      }
      const root = { projectRootPath, scope: "project" as const };
      setPending(true);
      try {
        if (checked) {
          let result = await context.projectMemory.enable(root);
          if (result.kind === "needsConfirmation") {
            const ok = await context.dialogs.confirm({
              body: t(
                "confirm.tracked.body",
                undefined,
                "Memory lives on this machine. These project configs are usually committed, so they won't work on other machines."
              ),
              intent: "default",
              title: t(
                "confirm.tracked.title",
                undefined,
                "Share memory configuration through git?"
              ),
            });
            if (!ok) {
              return;
            }
            result = await context.projectMemory.enable(root, {
              acknowledged: true,
            });
          }
          if (result.kind === "report") {
            await refresh();
          }
          return;
        }
        await context.projectMemory.disable(root);
        await refresh();
      } catch (err: unknown) {
        await context.dialogs.alert({
          body: err instanceof Error ? err.message : String(err),
          title: t("state.degraded", undefined, "Partially connected"),
        });
      } finally {
        setPending(false);
      }
    };

    if (!projectRootPath) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {t("empty.noProject", undefined, "No project open")}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "empty.noProjectHint",
                undefined,
                "Open a project folder to use project memory."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    const enabled = snapshot?.desiredState === "enabled";
    const degraded = snapshot?.derivedState === "degraded";

    return (
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="pier-memory-enable">
            {t("switch.enable", undefined, "Enable project memory")}
          </Label>
          <Switch
            checked={enabled}
            disabled={pending}
            id="pier-memory-enable"
            onCheckedChange={(value) => {
              onCheckedChange(value).catch(() => undefined);
            }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          {t(
            `state.${snapshot?.derivedState ?? "disabled"}`,
            undefined,
            snapshot?.derivedState ?? "Off"
          )}
        </p>
        {snapshot ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {t("summary.connected", { count: connectedAgentCount(snapshot) })}
            </p>
            <p>
              {t("summary.store", undefined, "Memory file location")}:{" "}
              {snapshot.storePath}
            </p>
            <p>
              {t("summary.engine", undefined, "Engine version")}:{" "}
              {snapshot.enginePackage}
            </p>
          </div>
        ) : null}
        {degraded ? (
          <Alert variant="warning">
            <AlertTitle>
              {t("state.degraded", undefined, "Partially connected")}
            </AlertTitle>
            <AlertDescription>
              <Button
                onClick={() => {
                  context.dialogs
                    .alert({
                      body: (snapshot?.targets ?? [])
                        .map(
                          (row) =>
                            `${row.configPath}: ${row.outcome}${row.detail ? ` (${row.detail})` : ""}`
                        )
                        .join("\n"),
                      title: t("degraded.details", undefined, "View details"),
                    })
                    .catch(() => undefined);
                }}
                variant="outline"
              >
                {t("degraded.details", undefined, "View details")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {enabled ? (
          <p className="text-muted-foreground text-sm">
            {t(
              "first.claudeTrust",
              undefined,
              "Claude Code asks one-time approval for project memory tools on first use."
            )}
          </p>
        ) : null}
      </div>
    );
  };
}
