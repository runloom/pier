import type {
  LiveModuleEvent,
  LiveModulesApi,
  LiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { LIVE_MODULE_COMPILE_TIMEOUT_MS } from "./compile.ts";
import {
  disposeAllCompileContexts,
  disposeCompileContextsForRoot,
} from "./compile-context-cache.ts";
import { stopEsbuildModule } from "./esbuild-binary.ts";
import { isPathWithinRoot } from "./fence.ts";
import { createLiveModuleGraphTracker, toStaleEvents } from "./graph.ts";
import { setLiveModulesService } from "./host.ts";
import { createLiveRootRegistry } from "./root-registry.ts";
import { runLiveModuleCompile } from "./service-compile.ts";

import {
  artifactUrl,
  createLiveModuleTicketRegistry,
  type LiveModuleTicketRegistry,
} from "./ticket-registry.ts";

/** Grace period before revoking a superseded ticket (in-flight import). */
const TICKET_REVOKE_GRACE_MS = 5000;

export interface LiveModulesService extends LiveModulesApi {
  dispose(): void;
  getArtifactByTicket(
    ticket: string
  ): { bytes: Buffer; moduleId: string; rootId: string } | undefined;
  getAssetByTicket(
    ticket: string
  ): { bytes: Buffer; mimeType: string } | undefined;
}

export interface CreateLiveModulesServiceOptions {
  broadcast?: (event: LiveModuleEvent) => void;
  compileTimeoutMs?: number;
  /** Must be synchronous for `registerRoot` (LiveModulesApi). */
  resolveHomeRoot: () => string;
  /**
   * Canvas project trust gate: return false to refuse compiling project-scope
   * roots that have no stored trust decision. Home-scope roots are never gated.
   * The refusal surfaces as a compile failure carrying `trust.projectRootPath`
   * so the renderer can drive the first-open confirm and retry after grant.
   */
  resolveProjectTrust?: (projectRootPath: string) => Promise<boolean>;
  ticketRegistry?: LiveModuleTicketRegistry;
}

export function createLiveModulesService(
  options: CreateLiveModulesServiceOptions
): LiveModulesService {
  const roots = createLiveRootRegistry();
  const tickets = options.ticketRegistry ?? createLiveModuleTicketRegistry();
  const graphTracker = createLiveModuleGraphTracker();
  const subscribers = new Map<string, Set<(event: LiveModuleEvent) => void>>();
  const moduleTickets = new Map<string, string>();
  const compileEpochs = new Map<string, number>();
  const compileTail = new Map<string, Promise<void>>();
  const rootRetainCounts = new Map<string, number>();
  const rootDisposers = new Map<string, () => void>();
  const pendingRevokes = new Map<string, ReturnType<typeof setTimeout>>();
  const timeoutMs = options.compileTimeoutMs ?? LIVE_MODULE_COMPILE_TIMEOUT_MS;

  const stopWatch = graphTracker.watch((changes) => {
    for (const event of toStaleEvents(changes)) {
      emit(event);
    }
  });

  function emit(event: LiveModuleEvent): void {
    options.broadcast?.(event);
    const set = subscribers.get(event.rootId);
    if (!set) {
      return;
    }
    for (const cb of set) {
      cb(event);
    }
  }

  function moduleKey(rootId: string, moduleId: string): string {
    return `${rootId}::${moduleId}`;
  }

  function scheduleTicketRevoke(ticket: string): void {
    const previous = pendingRevokes.get(ticket);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    pendingRevokes.set(
      ticket,
      setTimeout(() => {
        pendingRevokes.delete(ticket);
        tickets.revoke(ticket);
      }, TICKET_REVOKE_GRACE_MS)
    );
  }

  function revokeTicketNow(ticket: string): void {
    const pending = pendingRevokes.get(ticket);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingRevokes.delete(ticket);
    }
    tickets.revoke(ticket);
  }

  function clearRootArtifacts(rootId: string): void {
    for (const moduleId of graphTracker.listModuleIds(rootId)) {
      graphTracker.clearModule(rootId, moduleId);
    }
    graphTracker.clearRoot(rootId);
    for (const [key, ticket] of [...moduleTickets.entries()]) {
      if (key.startsWith(`${rootId}::`)) {
        moduleTickets.delete(key);
        revokeTicketNow(ticket);
      }
    }
    for (const key of [...compileEpochs.keys()]) {
      if (key.startsWith(`${rootId}::`)) {
        compileEpochs.delete(key);
      }
    }
    // Drop cached esbuild contexts (plugin closures + module graph) for this
    // root so re-registration with different resolve options builds fresh.
    disposeCompileContextsForRoot(rootId).catch(() => undefined);
  }

  function isSameFence(
    previous: {
      contentRoot: string;
      projectRoot: string | null;
      resolvedAnchorRoot: string;
    },
    next: {
      contentRoot: string;
      projectRoot: string | null;
      resolvedAnchorRoot: string;
    }
  ): boolean {
    return (
      previous.contentRoot === next.contentRoot &&
      previous.projectRoot === next.projectRoot &&
      previous.resolvedAnchorRoot === next.resolvedAnchorRoot
    );
  }

  function disposeRootFully(rootId: string): void {
    const dispose = rootDisposers.get(rootId);
    rootDisposers.delete(rootId);
    rootRetainCounts.delete(rootId);
    dispose?.();
    if (!roots.get(rootId)) {
      clearRootArtifacts(rootId);
    }
  }

  const service: LiveModulesService = {
    registerRoot(specInput: LiveRootSpec) {
      let anchorRoot: string;
      if (specInput.anchor.scope === "home") {
        anchorRoot = options.resolveHomeRoot();
      } else {
        const projectPath = specInput.anchor.projectRootPath.replace(
          /\/+$/u,
          ""
        );
        const homeRoot = options.resolveHomeRoot();
        if (
          isPathWithinRoot(projectPath, homeRoot) ||
          /[/\\]pier-home$/u.test(projectPath)
        ) {
          throw new Error(
            "pier-home must not be registered as a project live root"
          );
        }
        anchorRoot = specInput.anchor.projectRootPath;
      }

      const previous = roots.get(specInput.id);
      const { dispose: disposeRoot, root } = roots.register(
        specInput,
        anchorRoot
      );
      if (previous && !isSameFence(previous, root)) {
        clearRootArtifacts(specInput.id);
      }

      rootDisposers.set(specInput.id, () => {
        disposeRoot();
        if (!roots.get(specInput.id)) {
          clearRootArtifacts(specInput.id);
        }
      });

      return () => {
        disposeRoot();
        if (!roots.get(specInput.id)) {
          clearRootArtifacts(specInput.id);
          rootDisposers.delete(specInput.id);
          rootRetainCounts.delete(specInput.id);
        }
      };
    },

    retainRoot(specInput: LiveRootSpec) {
      service.registerRoot(specInput);
      const id = specInput.id;
      rootRetainCounts.set(id, (rootRetainCounts.get(id) ?? 0) + 1);
      return id;
    },

    releaseRoot(rootId: string) {
      const current = rootRetainCounts.get(rootId) ?? 0;
      if (current <= 1) {
        disposeRootFully(rootId);
        return;
      }
      rootRetainCounts.set(rootId, current - 1);
    },

    async compile(rootId, relPath) {
      const registered = roots.get(rootId);
      // Official plugin applets compile from the plugin package, not project
      // canvas files — skip the first-open canvas trust gate.
      const isPluginApplet = relPath.startsWith("@pier-applet/");
      if (
        !isPluginApplet &&
        registered?.projectRoot &&
        options.resolveProjectTrust &&
        !(await options.resolveProjectTrust(registered.projectRoot))
      ) {
        return {
          diagnostics: [
            {
              message:
                "canvas preview blocked: project root has no trust decision",
              severity: "error" as const,
            },
          ],
          ok: false as const,
          trust: { projectRootPath: registered.projectRoot },
        };
      }
      return runLiveModuleCompile(
        {
          compileEpochs,
          compileTail,
          emit,
          getRoot: (id) => roots.get(id),
          graphTracker,
          moduleKey,
          moduleTickets,
          scheduleTicketRevoke,
          tickets,
          timeoutMs,
        },
        rootId,
        relPath
      );
    },

    getUrl(rootId, moduleId) {
      const ticket = moduleTickets.get(moduleKey(rootId, moduleId));
      if (!ticket) {
        throw new Error(`no compiled module: ${rootId}/${moduleId}`);
      }
      const artifact = tickets.get(ticket);
      if (!artifact) {
        throw new Error(`missing artifact ticket for ${rootId}/${moduleId}`);
      }
      return artifactUrl(artifact);
    },

    subscribe(rootId, cb) {
      let set = subscribers.get(rootId);
      if (!set) {
        set = new Set();
        subscribers.set(rootId, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
        if (set?.size === 0) {
          subscribers.delete(rootId);
        }
      };
    },

    getArtifactByTicket(ticket) {
      const artifact = tickets.get(ticket);
      if (!artifact) {
        return;
      }
      return {
        bytes: artifact.bytes,
        moduleId: artifact.moduleId,
        rootId: artifact.rootId,
      };
    },

    getAssetByTicket(ticket) {
      const asset = tickets.getAsset(ticket);
      if (!asset) {
        return;
      }
      return {
        bytes: asset.bytes,
        mimeType: asset.mimeType,
      };
    },

    dispose() {
      stopWatch();
      subscribers.clear();
      rootRetainCounts.clear();
      rootDisposers.clear();
      compileTail.clear();
      for (const root of [...roots.list()]) {
        clearRootArtifacts(root.spec.id);
      }
      for (const ticket of [...pendingRevokes.keys()]) {
        revokeTicketNow(ticket);
      }
      for (const ticket of [...moduleTickets.values()]) {
        revokeTicketNow(ticket);
      }
      moduleTickets.clear();
      compileEpochs.clear();
      roots.clear();
      stopEsbuildModule().catch(() => undefined);
      disposeAllCompileContexts().catch(() => undefined);
      setLiveModulesService(null);
    },
  };

  return service;
}
