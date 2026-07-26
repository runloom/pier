import type {
  LiveModuleCompileResult,
  LiveModuleEvent,
  LiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

export interface PierLiveModulesAPI {
  compile(rootId: string, relPath: string): Promise<LiveModuleCompileResult>;
  getUrl(rootId: string, moduleId: string): Promise<string>;
  /**
   * Subscribe to compile/watch events (payload: LiveModuleEvent).
   * Viewer should recompile on `stale` for matching rootId + moduleId.
   */
  onChanged(cb: (event: LiveModuleEvent) => void): () => void;
  /** Refcounted register (pair with unregisterRoot when the panel closes). */
  registerRoot(spec: LiveRootSpec): Promise<{ rootId: string }>;
  unregisterRoot(rootId: string): Promise<{ rootId: string }>;
}

export const liveModulesApi: PierLiveModulesAPI = {
  compile: (rootId, relPath) =>
    invokePierCommand<LiveModuleCompileResult>({
      relPath,
      rootId,
      type: "liveModules.compile",
    }),
  getUrl: async (rootId, moduleId) => {
    const result = await invokePierCommand<{ url: string }>({
      moduleId,
      rootId,
      type: "liveModules.getUrl",
    });
    return result.url;
  },
  onChanged: (cb) =>
    subscribeIpc<LiveModuleEvent>(PIER_BROADCAST.LIVE_MODULES_CHANGED, cb),
  registerRoot: (spec) =>
    invokePierCommand<{ rootId: string }>({
      spec,
      type: "liveModules.registerRoot",
    }),
  unregisterRoot: (rootId) =>
    invokePierCommand<{ rootId: string }>({
      rootId,
      type: "liveModules.unregisterRoot",
    }),
};
