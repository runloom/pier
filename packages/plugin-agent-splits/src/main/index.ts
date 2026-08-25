import type { MainPluginModule } from "@pier/plugin-api/main";
import { installShim } from "./install-shim.ts";
import { ensureOmoShadow } from "./omo-shadow.ts";
import { PLUGIN_ID } from "./settings-keys.ts";
import { decorateLaunchSpawn, wrapLaunch } from "./wrap.ts";

export const plugin: MainPluginModule = {
  id: PLUGIN_ID,
  activate(context) {
    installShim({ workDir: context.paths.workDir });
    const wrapOptions = {
      workDir: context.paths.workDir,
      getConfig: (key: string) => context.configuration.get(key),
      ensureOmoShadow,
      logger: context.logger,
    };
    const unregister = context.launchWrap.register({
      decorateSpawn: async (input) => decorateLaunchSpawn(input, wrapOptions),
      wrap: async (input) => wrapLaunch(input, wrapOptions),
    });
    context.logger.info("[pier.agent-splits] activated");
    return () => {
      unregister();
    };
  },
};
