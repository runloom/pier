import type { MainPluginContext } from "@pier/plugin-api/main";
import { z } from "zod/mini";
import { SCHEMA_VERSION, UNRESOLVED_REPO } from "../shared/constants.ts";
import {
  assignPayloadSchema,
  bindingPayloadSchema,
  boardParamsSchema,
  catalogKeysPayloadSchema,
  closePayloadSchema,
  createItemPayloadSchema,
  createLabelsPayloadSchema,
  depPayloadSchema,
  jiraBaseUrlPayloadSchema,
  linearTeamKeyPayloadSchema,
  optionalPathPayloadSchema,
  parseTaskItemKey,
  projectionPayloadSchema,
  providerTokenPayloadSchema,
  pruneWorktreePayloadSchema,
  refreshPayloadSchema,
  revokeProviderPayloadSchema,
  setStatusPayloadSchema,
  sourcePayloadSchema,
  startAllReadyPayloadSchema,
  startWorkPayloadSchema,
} from "../shared/rpc.ts";
import { sourceBoardParams } from "../shared/source.ts";
import type { TaskBoardParams, TaskBoardSnapshot } from "../shared/types.ts";
import type { createTaskActions } from "./actions.ts";
import type { WorkClaimRegistry } from "./claims.ts";
import type { GithubCredentials } from "./credentials.ts";
import { type OverlayStore, overlaySchema } from "./overlay.ts";
import type { BoardPoller } from "./poller.ts";
import type { SourcePrefsStore } from "./prefs.ts";
import { listJiraProjects } from "./providers/jira.ts";
import {
  listLinearProjects,
  listLinearTeams,
} from "./providers/linear-catalog.ts";
import type { TrackerProvider } from "./providers/types.ts";

const itemKeySchema = z.object({
  itemKey: z.string().check(z.minLength(1)),
});

const focusedPayloadSchema = z.object({
  focused: z.boolean(),
});

const claimPayloadSchema = z.object({
  claimId: z.string().check(z.minLength(1)),
});

function requiredParams(
  payload: { params?: TaskBoardParams | undefined } | undefined
): TaskBoardParams {
  return boardParamsSchema.parse(payload?.params);
}

function isUnresolved(params: TaskBoardParams): boolean {
  return params.repo === UNRESOLVED_REPO;
}

function emptyBoard(params: TaskBoardParams): TaskBoardSnapshot {
  return {
    canWrite: false,
    columnMapping: "heuristic",
    columns: [
      { id: "todo", items: [], kind: "todo", readonly: false, title: "Todo" },
      {
        id: "inProgress",
        items: [],
        kind: "inProgress",
        readonly: false,
        title: "In Progress",
      },
      { id: "done", items: [], kind: "done", readonly: true, title: "Done" },
    ],
    cycleKeys: [],
    fetchedAt: 0,
    generation: 0,
    hasCycle: false,
    params,
    schemaVersion: SCHEMA_VERSION,
    truncated: false,
  };
}

export function registerTasksRpcHandlers(input: {
  actions: ReturnType<typeof createTaskActions>;
  claims: WorkClaimRegistry;
  credentials: GithubCredentials;
  emit: (event: string, payload: unknown) => void;
  overlays: OverlayStore;
  poller: BoardPoller;
  prefs: SourcePrefsStore;
  provider: TrackerProvider;
  rpc: MainPluginContext["rpc"];
}): void {
  const {
    actions,
    claims,
    credentials,
    emit,
    overlays,
    poller,
    prefs,
    provider,
    rpc,
  } = input;

  prefs.onChange((projectRootPath) => {
    emit("connection.changed", { projectRootPath });
  });

  // 插件事件广播到所有窗口；副作用类事件由各窗抢占，先到先得。
  rpc.handle("work.claim", async (payload) => {
    const parsed = claimPayloadSchema.parse(payload);
    return { granted: claims.claimOnce(parsed.claimId) };
  });

  rpc.handle("projection.board", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (isUnresolved(params)) {
      return emptyBoard(params);
    }
    return poller.snapshotBoard(params);
  });
  rpc.handle("projection.board.watch", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (!isUnresolved(params)) {
      await poller.watch(params);
    }
    return null;
  });
  rpc.handle("projection.board.unwatch", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (!isUnresolved(params)) {
      await poller.unwatch(params);
    }
    return null;
  });
  rpc.handle("projection.dag", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (isUnresolved(params)) {
      return {
        cycleKeys: [],
        edges: [],
        fetchedAt: 0,
        generation: 0,
        hasCycle: false,
        nodes: [],
        params,
        schemaVersion: SCHEMA_VERSION,
      };
    }
    return poller.snapshotDag(params);
  });
  rpc.handle("projection.dag.watch", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (!isUnresolved(params)) {
      await poller.watch(params);
    }
    return null;
  });
  rpc.handle("projection.dag.unwatch", async (payload) => {
    const parsed = projectionPayloadSchema.parse(payload ?? {});
    const params = requiredParams(parsed);
    if (!isUnresolved(params)) {
      await poller.unwatch(params);
    }
    return null;
  });

  rpc.handle("task.setStatus", async (payload) => {
    const parsed = setStatusPayloadSchema.parse(payload);
    return actions.setStatus(parsed);
  });
  rpc.handle("task.refresh", async (payload) => {
    const parsed = refreshPayloadSchema.parse(payload);
    return poller.refreshBoard(parsed.params, { force: true });
  });
  rpc.handle("task.create", async (payload) => {
    const parsed = createItemPayloadSchema.parse(payload);
    return actions.create(parsed);
  });
  rpc.handle("task.assign", async (payload) => {
    const parsed = assignPayloadSchema.parse(payload);
    return actions.assign(parsed);
  });
  rpc.handle("task.close", async (payload) => {
    const parsed = closePayloadSchema.parse(payload);
    return actions.close(parsed);
  });
  rpc.handle("task.dep.add", async (payload) => {
    const parsed = depPayloadSchema.parse(payload);
    if (!provider.addDependency) {
      throw new Error(
        "dependency edits are not available for this tracker yet"
      );
    }
    await provider.addDependency(
      parsed.blockedKey,
      parsed.blockerKey,
      parsed.params
    );
    return poller.refreshBoard(parsed.params, { force: true });
  });
  rpc.handle("task.dep.remove", async (payload) => {
    const parsed = depPayloadSchema.parse(payload);
    if (!provider.removeDependency) {
      throw new Error(
        "dependency edits are not available for this tracker yet"
      );
    }
    await provider.removeDependency(
      parsed.blockedKey,
      parsed.blockerKey,
      parsed.params
    );
    return poller.refreshBoard(parsed.params, { force: true });
  });
  rpc.handle("task.startWork", async (payload) => {
    const parsed = startWorkPayloadSchema.parse(payload);
    const existing = await overlays.get(parsed.itemKey);
    if (existing) {
      return { overlay: existing, reused: true };
    }
    const login = await provider.viewerLogin(parsed.params);
    if (login) {
      await provider.setAssignees(parsed.itemKey, [login], parsed.params);
    }
    const parsedKey = parseTaskItemKey(parsed.itemKey);
    const projectRootPath =
      parsed.projectRootPath ??
      (parsed.params.provider === "linear" || parsed.params.provider === "jira"
        ? null
        : await prefs.findProjectRootByOrigin(parsed.params.repo));
    if (!projectRootPath) {
      throw new Error("Open a project folder first.");
    }
    // Cached in the common case (the board is being watched); the title and
    // URL feed the agent prompt so it does not open on a bare issue number.
    const board = await poller.snapshotBoard(parsed.params).catch(() => null);
    const card = board?.columns
      .flatMap((column) => column.items)
      .find((item) => item.key === parsed.itemKey);
    const claim = {
      ...(parsed.agentId ? { agentId: parsed.agentId } : {}),
      itemKey: parsed.itemKey,
      number: parsedKey.number,
      projectRootPath,
      repo: parsed.params.repo,
      ...(card ? { title: card.title, url: card.url } : {}),
    };
    emit("work.orchestrate", { ...claim, claimId: claims.issue() });
    return { claim, reused: false };
  });
  rpc.handle("task.pruneWorktree", async (payload) => {
    const parsed = pruneWorktreePayloadSchema.parse(payload);
    const overlay = await overlays.get(parsed.itemKey);
    await overlays.clear(parsed.itemKey);
    if (overlay) {
      emit("work.prune", { ...overlay, claimId: claims.issue() });
    }
    await poller.repaint();
    return { overlay };
  });
  rpc.handle("task.startAllReady", async (payload) => {
    const parsed = startAllReadyPayloadSchema.parse(payload);
    const board = await poller.snapshotBoard(parsed.params);
    const ready = board.columns
      .filter(
        (column) =>
          column.kind !== "done" &&
          column.kind !== "canceled" &&
          column.id !== "done"
      )
      .flatMap((column) => column.items)
      .filter((item) => item.openBlockedByCount === 0);
    const cap = Math.min(parsed.limit ?? 5, 8);
    return { itemKeys: ready.slice(0, cap).map((item) => item.key) };
  });

  const autoFillCatalogs = async (
    provider: "jira" | "linear"
  ): Promise<void> => {
    const snapshot = await prefs.get(prefs.lastTouchedPath() ?? "");
    if (provider === "linear" && snapshot.linearTeamKeys.length === 0) {
      const teams = await listLinearTeams({
        getToken: () => credentials.getProviderToken("linear"),
      });
      if (teams.length > 0) {
        await prefs.setLinearTeamKeys(teams.map((team) => team.key));
      }
    }
    if (provider === "jira" && snapshot.jiraProjectKeys.length === 0) {
      const projects = await listJiraProjects({
        baseUrl: () => credentials.getJiraBaseUrl(),
        getToken: () => credentials.getProviderToken("jira"),
      });
      if (projects.length === 0) {
        return;
      }
      const keys =
        projects.length <= 20
          ? projects.map((project) => project.key)
          : [projects[0]?.key ?? ""];
      await prefs.setJiraProjectKeys(keys.filter((key) => key.length > 0));
    }
  };

  const isTrackerAuthError = (error: unknown): boolean =>
    error instanceof Error &&
    /not authorized|HTTP 401|HTTP 403/i.test(error.message);

  const saveProviderToken = async (
    provider: "github" | "jira" | "linear",
    token: string
  ): Promise<void> => {
    await credentials.setProviderToken(provider, token);
    if (provider !== "linear" && provider !== "jira") {
      return;
    }
    try {
      await autoFillCatalogs(provider);
    } catch (error: unknown) {
      if (isTrackerAuthError(error)) {
        await credentials.deleteProvider(provider);
        throw error;
      }
    }
  };

  rpc.handle("source.status", async (payload) => {
    const parsed = bindingPayloadSchema.parse(payload);
    const [snapshot, credential] = await Promise.all([
      prefs.get(parsed.projectRootPath),
      credentials.status(),
    ]);
    return { ...snapshot, credential };
  });
  rpc.handle("source.resolve", async (payload) => {
    const parsed = optionalPathPayloadSchema.parse(payload ?? {});
    const path = parsed.projectRootPath ?? prefs.lastTouchedPath() ?? "";
    const [snapshot, credential] = await Promise.all([
      prefs.get(path),
      credentials.status(),
    ]);
    const scoped = sourceBoardParams(snapshot);
    return {
      ...snapshot,
      credential,
      params: "repo" in scoped ? scoped : null,
    };
  });
  rpc.handle("source.set", async (payload) => {
    const parsed = sourcePayloadSchema.parse(payload);
    if (parsed.lastSource) {
      await prefs.setLastSource(parsed.projectRootPath, parsed.lastSource);
    }
    if (parsed.lastLinearTeam) {
      await prefs.setLastLinearTeam(
        parsed.projectRootPath,
        parsed.lastLinearTeam
      );
    }
    if (parsed.lastJiraProject) {
      await prefs.setLastJiraProject(
        parsed.projectRootPath,
        parsed.lastJiraProject
      );
    }
    if (parsed.lastLinearProject !== undefined) {
      await prefs.setLastLinearProject(
        parsed.projectRootPath,
        parsed.lastLinearProject.length > 0 ? parsed.lastLinearProject : null
      );
    }
    const [snapshot, credential] = await Promise.all([
      prefs.get(parsed.projectRootPath),
      credentials.status(),
    ]);
    return { ...snapshot, credential };
  });
  rpc.handle("source.setLinearTeams", async (payload) => {
    const parsed = catalogKeysPayloadSchema.parse(payload);
    await prefs.setLinearTeamKeys(parsed.keys);
    return { keys: parsed.keys };
  });
  rpc.handle("source.setJiraProjects", async (payload) => {
    const parsed = catalogKeysPayloadSchema.parse(payload);
    await prefs.setJiraProjectKeys(parsed.keys);
    return { keys: parsed.keys };
  });
  rpc.handle("source.listLinearTeams", async () => ({
    teams: await listLinearTeams({
      getToken: () => credentials.getProviderToken("linear"),
    }),
  }));
  rpc.handle("source.listLinearProjects", async (payload) => {
    const parsed = linearTeamKeyPayloadSchema.parse(payload);
    return {
      projects: await listLinearProjects({
        getToken: () => credentials.getProviderToken("linear"),
        teamKey: parsed.teamKey,
      }),
    };
  });
  rpc.handle("source.listJiraProjects", async () => ({
    projects: await listJiraProjects({
      baseUrl: () => credentials.getJiraBaseUrl(),
      getToken: () => credentials.getProviderToken("jira"),
    }),
  }));
  rpc.handle("connection.detectRemote", async (payload) => {
    const parsed = bindingPayloadSchema.parse(payload);
    return { repo: await prefs.detectRemote(parsed.projectRootPath) };
  });
  rpc.handle("connection.authorize", async () => {
    const probed = await credentials.probeGhToken();
    if (!probed) {
      throw new Error("not authorized");
    }
    await credentials.setToken(probed);
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.authorizeLinear", async () => {
    const probed = await credentials.probeLinearToken();
    if (!probed) {
      throw new Error("not authorized");
    }
    await saveProviderToken("linear", probed);
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.revoke", async () => {
    await credentials.delete();
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.setProviderToken", async (payload) => {
    const parsed = providerTokenPayloadSchema.parse(payload);
    await saveProviderToken(parsed.provider, parsed.token);
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.setJiraBaseUrl", async (payload) => {
    const parsed = jiraBaseUrlPayloadSchema.parse(payload);
    await credentials.setJiraBaseUrl(parsed.url);
    await autoFillCatalogs("jira").catch(() => undefined);
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.revokeProvider", async (payload) => {
    const parsed = revokeProviderPayloadSchema.parse(payload);
    await credentials.deleteProvider(parsed.provider);
    emit("connection.changed", {});
    return credentials.status();
  });
  rpc.handle("connection.createLabels", async (payload) => {
    const parsed = createLabelsPayloadSchema.parse(payload);
    await provider.createStandardLabels(parsed.repo);
    return null;
  });
  rpc.handle("overlay.record", async (payload) => {
    const parsed = overlaySchema.parse(payload);
    await overlays.set(parsed);
    await poller.repaint();
    return parsed;
  });
  rpc.handle("overlay.get", async (payload) => {
    const parsed = itemKeySchema.parse(payload);
    return overlays.get(parsed.itemKey);
  });
  rpc.handle("poller.setFocused", async (payload) => {
    const parsed = focusedPayloadSchema.parse(payload);
    poller.setFocused(parsed.focused);
    return null;
  });
}
