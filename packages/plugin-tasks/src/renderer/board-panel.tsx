import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Empty, EmptyHeader, EmptyTitle } from "@pier/ui/empty.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  activeJiraProject,
  activeLinearProject,
  activeLinearTeam,
  sourceBlockReason,
  sourceBoardParams,
} from "../shared/source.ts";
import type {
  SourceStatus,
  TaskBoardParams,
  TaskProvider,
  TrackerCatalogItem,
} from "../shared/types.ts";
import { AppletFrame } from "./applet-frame.tsx";
import { HeaderMenu, TaskPanelHeader } from "./panel-header.tsx";
import { SourceSetup } from "./source-setup.tsx";
import { formatUnknownError, type Translate } from "./translate.ts";
import { BoardViewSkeleton, ListViewSkeleton } from "./view-skeleton.tsx";

type TrackerView = "board" | "list";

const APPLET_BY_VIEW: Record<TrackerView, string> = {
  board: "tracker-board",
  list: "task-list",
};

function projectRootFromPanelProps(
  props: Record<string, unknown>
): string | null {
  const params = props.params;
  if (!params || typeof params !== "object") {
    return null;
  }
  const context = (params as { context?: { projectRootPath?: unknown } })
    .context;
  if (!context || typeof context !== "object") {
    return null;
  }
  return typeof context.projectRootPath === "string" &&
    context.projectRootPath.length > 0
    ? context.projectRootPath
    : null;
}

function overlayBoardParams(
  resolved: TaskBoardParams,
  input: {
    jiraProject: string | null;
    linearProject: string | null;
    linearTeam: string | null;
    source: TaskProvider;
  }
): TaskBoardParams {
  if (input.source === "jira") {
    return {
      ...resolved,
      ...(input.jiraProject ? { repo: input.jiraProject } : {}),
    };
  }
  if (input.source !== "linear") {
    return resolved;
  }
  return {
    repo: input.linearTeam ?? resolved.repo,
    ...(resolved.provider ? { provider: resolved.provider } : {}),
    ...(input.linearProject ? { projectId: input.linearProject } : {}),
  };
}

export function createTaskBoardPanel(context: ExternalRendererPluginContext) {
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
  return function TaskBoardPanel(props: Record<string, unknown>) {
    const projectRootPath = projectRootFromPanelProps(props);
    const [status, setStatus] = useState<SourceStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<TrackerView>("board");
    const [sourceOverride, setSourceOverride] = useState<TaskProvider | null>(
      null
    );
    const [teamOverride, setTeamOverride] = useState<string | null>(null);
    const [linearProjectOverride, setLinearProjectOverride] = useState<
      string | null
    >(null);
    const [projectOverride, setProjectOverride] = useState<string | null>(null);
    const [linearProjects, setLinearProjects] = useState<TrackerCatalogItem[]>(
      []
    );
    const [refreshing, setRefreshing] = useState(false);

    const refresh = useCallback(async () => {
      if (!projectRootPath) {
        setStatus(null);
        return;
      }
      const next = await context.rpc.invoke<SourceStatus>("source.status", {
        projectRootPath,
      });
      setStatus(next);
      setError(null);
    }, [projectRootPath]);

    useEffect(() => {
      let cancelled = false;
      refresh().catch((caught: unknown) => {
        if (!cancelled) {
          setError(formatUnknownError(caught));
        }
      });
      return () => {
        cancelled = true;
      };
    }, [refresh]);

    useEffect(
      () =>
        context.rpc.on("connection.changed", () => {
          refresh().catch(() => undefined);
        }),
      [refresh]
    );

    const catalogSource = sourceOverride ?? status?.lastSource ?? "github";
    const catalogTeam =
      teamOverride ?? (status ? activeLinearTeam(status) : null);

    useEffect(() => {
      if (
        catalogSource !== "linear" ||
        !catalogTeam ||
        !status?.credential.linearAuthorized
      ) {
        setLinearProjects([]);
        return;
      }
      let cancelled = false;
      context.rpc
        .invoke<{ projects?: TrackerCatalogItem[] }>(
          "source.listLinearProjects",
          { teamKey: catalogTeam }
        )
        .then((result) => {
          if (!cancelled) {
            setLinearProjects(result.projects ?? []);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLinearProjects([]);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [catalogSource, catalogTeam, status?.credential.linearAuthorized]);

    const persistSource = (patch: Record<string, unknown>) => {
      if (!projectRootPath) {
        return;
      }
      context.rpc
        .invoke<SourceStatus>("source.set", { projectRootPath, ...patch })
        .then((next) => {
          setStatus(next);
          setSourceOverride(null);
          setTeamOverride(null);
          setLinearProjectOverride(null);
          setProjectOverride(null);
        })
        .catch((caught: unknown) => {
          setSourceOverride(null);
          setTeamOverride(null);
          setLinearProjectOverride(null);
          setProjectOverride(null);
          context.dialogs
            .alert({
              body: formatUnknownError(caught),
              title: t(
                "pier.tasks.connection.actionFailed",
                "Couldn't update tracker"
              ),
            })
            .catch(() => undefined);
        });
    };

    if (!projectRootPath) {
      return (
        <Empty className="h-full" data-pier-tasks-scope="">
          <EmptyHeader>
            <EmptyTitle>
              {t("pier.tasks.panel.noProject", "Open a project folder first.")}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    }

    const source = sourceOverride ?? status?.lastSource ?? "github";
    const linearTeam =
      teamOverride ?? (status ? activeLinearTeam(status) : null);
    const linearProject =
      linearProjectOverride ?? (status ? activeLinearProject(status) : null);
    const jiraProject =
      projectOverride ?? (status ? activeJiraProject(status) : null);
    const blocked = status ? sourceBlockReason(status, source) : null;
    const resolved = status ? sourceBoardParams(status, source) : null;
    const params =
      resolved && "repo" in resolved
        ? overlayBoardParams(resolved, {
            jiraProject,
            linearProject,
            linearTeam,
            source,
          })
        : null;

    const skeleton =
      view === "board" ? <BoardViewSkeleton /> : <ListViewSkeleton />;

    const renderPanelBody = () => {
      if (error && !status) {
        return (
          <ErrorEmpty
            description={t(
              "pier.tasks.panel.loadFailedBody",
              "Retry. If it still fails, restart Pier."
            )}
            detailAction={{
              label: t("pier.tasks.panel.loadFailedDetails", "Show details"),
              onClick: () => {
                context.dialogs
                  .alert({
                    body: error,
                    title: t(
                      "pier.tasks.panel.loadFailed",
                      "Couldn't load tracker"
                    ),
                  })
                  .catch(() => undefined);
              },
            }}
            retryAction={{
              label: t("pier.tasks.connection.retry", "Retry"),
              onClick: () => {
                refresh().catch(() => undefined);
              },
            }}
            title={t("pier.tasks.panel.loadFailed", "Couldn't load tracker")}
          />
        );
      }
      if (blocked && status) {
        return (
          <SourceSetup
            context={context}
            onDone={() => {
              refresh().catch(() => undefined);
            }}
            reason={blocked}
            status={status}
            t={t}
          />
        );
      }
      if (params && "repo" in params) {
        return (
          <AppletFrame key={view} skeleton={skeleton}>
            {context.applets.render({
              appletId: APPLET_BY_VIEW[view],
              projectRootPath,
              props: {
                chrome: "panel",
                projectRootPath,
                provider: params.provider,
                repo: params.repo,
                ...(params.projectId ? { projectId: params.projectId } : {}),
              },
            })}
          </AppletFrame>
        );
      }
      return skeleton;
    };

    const filterMenus = (
      <>
        {source === "linear" &&
        !blocked &&
        status &&
        status.linearTeamKeys.length > 0 ? (
          <HeaderMenu
            items={status.linearTeamKeys.map((key) => ({
              label: key,
              value: key,
            }))}
            label={t("pier.tasks.panel.linearTeam", "Linear team")}
            onChange={(key) => {
              setTeamOverride(key);
              persistSource({ lastLinearTeam: key });
            }}
            value={linearTeam ?? ""}
            valueLabel={linearTeam ?? ""}
          />
        ) : null}
        {source === "linear" && !blocked && linearProjects.length > 0 ? (
          <HeaderMenu
            items={[
              {
                label: t("pier.tasks.panel.linearProjectAll", "All issues"),
                value: "__all__",
              },
              ...linearProjects.map((item) => ({
                label: item.name,
                value: item.key,
              })),
            ]}
            label={t("pier.tasks.panel.linearProject", "Linear project")}
            onChange={(key) => {
              const next = key === "__all__" ? "" : key;
              setLinearProjectOverride(next);
              persistSource({ lastLinearProject: next });
            }}
            value={
              linearProject && linearProject.length > 0
                ? linearProject
                : "__all__"
            }
            valueLabel={
              linearProjects.find((item) => item.key === linearProject)?.name ??
              t("pier.tasks.panel.linearProjectAll", "All issues")
            }
          />
        ) : null}
        {source === "jira" &&
        !blocked &&
        status &&
        status.jiraProjectKeys.length > 0 ? (
          <HeaderMenu
            items={status.jiraProjectKeys.map((key) => ({
              label: key,
              value: key,
            }))}
            label={t("pier.tasks.panel.jiraProject", "Jira project")}
            onChange={(key) => {
              setProjectOverride(key);
              persistSource({ lastJiraProject: key });
            }}
            value={jiraProject ?? ""}
            valueLabel={jiraProject ?? ""}
          />
        ) : null}
      </>
    );

    return (
      <div
        className="flex h-full min-h-0 min-w-0 flex-col"
        data-pier-tasks-scope=""
      >
        <TaskPanelHeader
          center={
            <div className="flex min-w-0 items-center gap-1">{filterMenus}</div>
          }
          disabled={!status || refreshing}
          onRefresh={() => {
            if (refreshing) {
              return;
            }
            setRefreshing(true);
            const work = async () => {
              await refresh();
              if (params && "repo" in params) {
                await context.rpc.invoke("task.refresh", { params });
              }
            };
            work()
              .catch((caught: unknown) => {
                context.dialogs
                  .alert({
                    body: formatUnknownError(caught),
                    title: t(
                      "pier.tasks.connection.actionFailed",
                      "Couldn't update tracker"
                    ),
                  })
                  .catch(() => undefined);
              })
              .finally(() => {
                setRefreshing(false);
              });
          }}
          onSourceChange={(next) => {
            setSourceOverride(next);
            persistSource({ lastSource: next });
          }}
          onViewChange={setView}
          refreshing={refreshing}
          source={source}
          t={t}
          view={view}
        />
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          {renderPanelBody()}
        </div>
      </div>
    );
  };
}
