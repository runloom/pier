import { join } from "node:path";
import type { MainPluginModule } from "@pier/plugin-api/main";
import { createTaskActions } from "./actions.ts";
import { createBoardCache } from "./cache.ts";
import { createWorkClaimRegistry } from "./claims.ts";
import { createGithubCredentials } from "./credentials.ts";
import { createOverlayStore } from "./overlay.ts";
import { createBoardPoller } from "./poller.ts";
import { createSourcePrefsStore } from "./prefs.ts";
import { createRoutedTrackerProvider } from "./providers/route.ts";
import { registerTasksRpcHandlers } from "./rpc-handlers.ts";
import { createKeyedMutationLanes } from "./serial-queue.ts";

export const plugin: MainPluginModule = {
  id: "pier.tasks",
  async activate(context) {
    const credentials = createGithubCredentials({
      logger: context.logger,
      processEnv: context.processEnv,
      secrets: context.secrets,
    });
    const provider = createRoutedTrackerProvider({
      getJiraBaseUrl: () => credentials.getJiraBaseUrl(),
      getToken: (kind) => credentials.getProviderToken(kind),
    });
    const cache = createBoardCache(
      join(context.paths.dataDir, "board-cache.json")
    );
    await cache.init();
    const overlays = createOverlayStore(
      join(context.paths.workDir, "overlays.json")
    );
    const claims = createWorkClaimRegistry();
    const poller = createBoardPoller({
      cache,
      emitBoard: (snapshot) => {
        context.events.emit("projection.board", {
          ...snapshot,
          params: snapshot.params,
        });
      },
      emitDag: (snapshot) => {
        context.events.emit("projection.dag", snapshot);
      },
      emitUnlocked: (payload) => {
        context.events.emit("board.unlocked", {
          ...payload,
          claimId: claims.issue(),
        });
      },
      logger: context.logger,
      overlays,
      provider,
    });
    const actions = createTaskActions({
      laneFor: createKeyedMutationLanes(),
      provider,
      read: (params) => poller.snapshotBoard(params),
      refresh: (params) => poller.refreshBoard(params, { force: true }),
    });
    registerTasksRpcHandlers({
      actions,
      prefs: createSourcePrefsStore({
        filePath: join(context.paths.workDir, "bindings.json"),
      }),
      claims,
      credentials,
      emit: (event, payload) => {
        context.events.emit(event, payload);
      },
      overlays,
      poller,
      provider,
      rpc: context.rpc,
    });
    context.logger.info("[pier.tasks] activated");
    return () => undefined;
  },
};
