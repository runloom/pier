import { DIALOG_SECTION_TITLE_CLASS } from "@pier/ui/dialog-form-layout.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ItemGroup } from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import type {
  AssetRootRef,
  McpOwnership,
  McpServerListing,
  McpServerView,
} from "@shared/contracts/agent/assets.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { Cable } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  openAbsoluteInPierEditor,
  openUnderRootInPierEditor,
} from "@/lib/files/shell-path-actions.ts";
import { getPluginProjectSettingsRegistrations } from "@/lib/plugins/project-settings-registry.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { agentLabel } from "./mcp-agent-chips.tsx";
import { normalizeServers } from "./mcp-normalize.ts";
import {
  McpServerRow,
  MEMORY_PROJECT_SETTINGS_TAB,
} from "./mcp-server-row.tsx";

const FILTER_ALL = "all";

const GROUP_ORDER: readonly McpOwnership[] = [
  "pier-managed",
  "project",
  "user",
];

function assetRootFor(
  projectRootPath: string,
  isPierHome: boolean
): AssetRootRef {
  return isPierHome ? { scope: "home" } : { scope: "project", projectRootPath };
}

function groupTitle(
  ownership: McpOwnership,
  t: ReturnType<typeof useT>
): string {
  if (ownership === "pier-managed") return t("settings.projects.mcpGroupPier");
  if (ownership === "project") return t("settings.projects.mcpGroupProject");
  return t("settings.projects.mcpGroupUser");
}

function discoverableAgentIds(servers: readonly McpServerView[]): string[] {
  const ids = new Set<string>();
  for (const server of servers) {
    for (const cell of server.effects) {
      if (cell.effect.state === "discoverable") ids.add(cell.agentKind);
    }
  }
  return [...ids].sort((a, b) => agentLabel(a).localeCompare(agentLabel(b)));
}

export function ProjectMcpPanel({
  isPierHome,
  projectRootPath,
}: {
  isPierHome: boolean;
  projectRootPath: string;
}) {
  const t = useT();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainNeedsReload, setMainNeedsReload] = useState(false);
  const [agentFilter, setAgentFilter] = useState(FILTER_ALL);

  useEffect(() => {
    let cancelled = false;
    const root = assetRootFor(projectRootPath, isPierHome);
    setLoading(true);
    setMainNeedsReload(false);
    window.pier.agentAssets.mcp
      .catalog(root)
      .then((snap) => {
        if (cancelled) return;
        const hasServersField = Array.isArray(snap?.servers);
        setMainNeedsReload(!hasServersField);
        setServers(normalizeServers(snap?.servers));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setServers([]);
          setMainNeedsReload(false);
        }
        showAppAlert({
          title: t("settings.projects.mcpLoadFailed"),
          body: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRootPath, isPierHome, t]);

  const filterAgents = useMemo(() => discoverableAgentIds(servers), [servers]);

  const visibleServers = useMemo(() => {
    if (agentFilter === FILTER_ALL) return servers;
    return servers.filter((server) =>
      server.effects.some(
        (cell) =>
          cell.effect.state === "discoverable" && cell.agentKind === agentFilter
      )
    );
  }, [agentFilter, servers]);

  const canOpenMemory =
    !isPierHome &&
    getPluginProjectSettingsRegistrations().some(
      (item) => item.id === MEMORY_PROJECT_SETTINGS_TAB
    );

  function openListing(listing: McpServerListing) {
    const result =
      listing.scopeLabel === "project" && !isPierHome
        ? openUnderRootInPierEditor(projectRootPath, listing.displayPath)
        : openAbsoluteInPierEditor(listing.absolutePath);
    if (!result.ok) {
      showAppAlert({
        title: t("settings.projects.mcpActionFailed"),
        body: result.reason,
      }).catch(() => undefined);
    }
  }

  function openMemory() {
    useSettingsDialogStore
      .getState()
      .setProjectsTab(MEMORY_PROJECT_SETTINGS_TAB);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          {t("settings.projects.mcpNoticeBody")}
        </p>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cable />
            </EmptyMedia>
            <EmptyTitle>
              {mainNeedsReload
                ? t("settings.projects.mcpRestartTitle")
                : t("settings.projects.mcpEmptyTitle")}
            </EmptyTitle>
            <EmptyDescription>
              {mainNeedsReload
                ? t("settings.projects.mcpRestartDescription")
                : t("settings.projects.mcpEmptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("settings.projects.mcpNoticeBody")}
      </p>
      {filterAgents.length >= 2 ? (
        <ToggleGroup
          aria-label={t("settings.projects.mcpFilterGroupLabel")}
          className="flex-wrap"
          onValueChange={(value) => {
            if (!value) return;
            setAgentFilter(value);
          }}
          type="single"
          value={agentFilter}
          variant="outline"
        >
          <ToggleGroupItem value={FILTER_ALL}>
            {t("settings.projects.mcpFilterAll")}
          </ToggleGroupItem>
          {filterAgents.map((agentKind) => (
            <ToggleGroupItem key={agentKind} value={agentKind}>
              {agentLabel(agentKind as AgentKind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      {visibleServers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("settings.projects.mcpFilterEmpty")}
        </p>
      ) : (
        GROUP_ORDER.map((ownership) => {
          const group = visibleServers.filter(
            (server) => server.ownership === ownership
          );
          if (group.length === 0) return null;
          return (
            <section className="flex min-w-0 flex-col gap-2" key={ownership}>
              <h3 className={DIALOG_SECTION_TITLE_CLASS}>
                {groupTitle(ownership, t)}
              </h3>
              <ItemGroup className="gap-2" data-size="sm">
                {group.map((server) => (
                  <McpServerRow
                    canOpenMemory={canOpenMemory}
                    key={server.name}
                    onOpenListing={openListing}
                    onOpenMemory={openMemory}
                    server={server}
                    t={t}
                  />
                ))}
              </ItemGroup>
            </section>
          );
        })
      )}
    </div>
  );
}
