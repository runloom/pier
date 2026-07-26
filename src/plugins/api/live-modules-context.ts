import type {
  LiveModuleCompileResult,
  LiveModuleEvent,
  LiveRootSpec,
} from "@shared/contracts/live-modules.ts";

/** Renderer plugin host surface for Live Modules (C 轨). */
export interface RendererLiveModulesApi {
  compile(rootId: string, relPath: string): Promise<LiveModuleCompileResult>;
  getUrl(rootId: string, moduleId: string): Promise<string>;
  onChanged(cb: (event: LiveModuleEvent) => void): () => void;
  registerRoot(spec: LiveRootSpec): Promise<{ rootId: string }>;
  unregisterRoot(rootId: string): Promise<{ rootId: string }>;
}
