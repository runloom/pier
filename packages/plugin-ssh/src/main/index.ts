import { join } from "node:path";
import type { MainPluginModule } from "@pier/plugin-api/main";
import { HOSTS_CHANGED_EVENT } from "../shared/hosts.ts";
import { createSshHostStore } from "./host-store.ts";
import { registerSshRpcHandlers } from "./rpc-handlers.ts";

export const plugin: MainPluginModule = {
  id: "pier.ssh",
  async activate(context) {
    const lifetime = new AbortController();
    const store = createSshHostStore({
      filePath: join(context.paths.workDir, "hosts.json"),
      onChanged: (snapshot) =>
        context.events.emit(HOSTS_CHANGED_EVENT, snapshot),
      warn: (message, meta) => context.logger.warn(message, meta),
    });
    // Register RPC before init so renderer snapshot calls during boot/reload
    // do not hit "No RPC handler registered".
    registerSshRpcHandlers({
      processEnv: context.processEnv,
      rpc: context.rpc,
      signal: lifetime.signal,
      store,
    });
    await store.init();
    context.logger.info("[pier.ssh] activated");
    return () => {
      lifetime.abort();
    };
  },
};
