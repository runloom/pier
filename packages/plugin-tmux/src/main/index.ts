import type { MainPluginModule } from "@pier/plugin-api/main";
import { installShim } from "./install-shim.ts";
import { PLUGIN_ID } from "./settings-keys.ts";
import { decorateLaunchSpawn, wrapLaunch } from "./wrap.ts";

export const plugin: MainPluginModule = {
  id: PLUGIN_ID,
  activate(context) {
    installShim({ workDir: context.paths.workDir });
    const unregister = context.launchWrap.register({
      decorateSpawn: async (input) =>
        decorateLaunchSpawn(input, { workDir: context.paths.workDir }),
      wrap: async (input) =>
        wrapLaunch(input, { workDir: context.paths.workDir }),
    });
    context.logger.info("[pier.tmux] activated");
    return () => {
      unregister();
    };
  },
};
