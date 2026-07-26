import type { LiveRootSpec } from "@shared/contracts/live-modules.ts";
import { liveRootSpecSchema } from "@shared/contracts/live-modules.ts";
import { fenceRootForSpec } from "./fence.ts";

export interface RegisteredLiveRoot {
  contentRoot: string;
  projectRoot: string | null;
  resolvedAnchorRoot: string;
  spec: LiveRootSpec;
}

export interface LiveRootRegistry {
  clear(): void;
  get(rootId: string): RegisteredLiveRoot | undefined;
  list(): RegisteredLiveRoot[];
  register(
    spec: LiveRootSpec,
    resolvedAnchorRoot: string
  ): { dispose: () => void; root: RegisteredLiveRoot };
}

export function createLiveRootRegistry(): LiveRootRegistry {
  const roots = new Map<string, RegisteredLiveRoot>();

  return {
    clear() {
      roots.clear();
    },
    get(rootId) {
      return roots.get(rootId);
    },
    list() {
      return [...roots.values()];
    },
    register(specInput, resolvedAnchorRoot) {
      const spec = liveRootSpecSchema.parse(specInput);
      // Re-register replaces the previous root (plugin activate / HMR safe).
      // Do not delete before fence succeeds — failed fence keeps prior root.
      const fenced = fenceRootForSpec(spec, resolvedAnchorRoot);
      const root: RegisteredLiveRoot = {
        contentRoot: fenced.contentRoot,
        projectRoot: fenced.projectRoot,
        resolvedAnchorRoot,
        spec,
      };
      roots.set(spec.id, root);
      return {
        dispose: () => {
          // Only delete if this registration is still current.
          if (roots.get(spec.id) === root) {
            roots.delete(spec.id);
          }
        },
        root,
      };
    },
  };
}
