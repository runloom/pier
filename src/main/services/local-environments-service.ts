import type { spawn as nodeSpawn } from "node:child_process";
import { realpath as fsRealpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  EnvironmentProjectRequest,
  EnvironmentSnapshotRequest,
  EnvironmentUpdateRequest,
  EnvironmentWorktreeBindingRequest,
  LocalEnvironmentProject,
  LocalEnvironmentProjectFile,
  LocalEnvironmentProjectKind,
  LocalEnvironmentState,
  LocalEnvironmentWorktreeBindingSnapshot,
} from "@shared/contracts/environment.ts";
import { app } from "electron";
import type { LocalEnvironmentLifecyclePhase } from "./local-environment-scripts.ts";
import { runLocalEnvironmentLifecycle } from "./local-environment-scripts.ts";
import {
  createLocalEnvironmentStateStore,
  deleteProjectFile,
  type LocalEnvironmentGlobalState,
  type LocalEnvironmentIndexEntry,
  readProjectFile,
  writeProjectFile,
} from "./local-environment-store.ts";
import {
  defaultWireProject,
  entryKind,
  findIndexEntry,
  LocalEnvironmentServiceError,
  seedProjectFile,
  toWireProject,
} from "./local-environments-service-wire.ts";
import type { ProcessEnvironmentService } from "./process-environment-service.ts";

export { LocalEnvironmentServiceError } from "./local-environments-service-wire.ts";

export interface LocalEnvironmentService {
  addProject(
    request: EnvironmentProjectRequest
  ): Promise<LocalEnvironmentState>;
  bindWorktree(request: {
    projectRootPath: string;
    worktreePath: string;
  }): Promise<void>;
  clearWorktreeBinding(worktreePath: string): Promise<void>;
  /** Resolve index kind for a registered root (after realpath). */
  getProjectKind(
    projectRootPath: string
  ): Promise<LocalEnvironmentProjectKind | null>;
  projectSnapshot(
    projectRootPath: string
  ): Promise<LocalEnvironmentProject | null>;
  removeProject(
    request: EnvironmentProjectRequest
  ): Promise<LocalEnvironmentState>;
  resolveForWorktree(worktreePath: string): Promise<{
    project: LocalEnvironmentProject;
    projectRootPath: string;
  } | null>;
  resolveProject(
    projectRootPath: string
  ): Promise<LocalEnvironmentProject | null>;
  runLifecycle(request: {
    cwd: string;
    project: LocalEnvironmentProject;
    phase: LocalEnvironmentLifecyclePhase;
  }): Promise<void>;
  snapshot(
    request?: EnvironmentSnapshotRequest
  ): Promise<LocalEnvironmentState>;
  updateProject(
    request: EnvironmentUpdateRequest
  ): Promise<LocalEnvironmentState>;
  /**
   * Dedicated Pier Home upsert: index only, never seeds
   * `.pier/environment.json`.
   */
  upsertPierHome(projectRootPath: string): Promise<LocalEnvironmentState>;
  worktreeBinding(
    request: EnvironmentWorktreeBindingRequest
  ): Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
}

export function createLocalEnvironmentService(options: {
  filePath?: string;
  /** When set, addProject rejects this root; used for pier-home path. */
  isPierHomeRoot?: (path: string) => Promise<boolean>;
  now?: () => number;
  processEnvironment: ProcessEnvironmentService;
  realpath?: (path: string) => Promise<string>;
  spawn?: typeof nodeSpawn;
}): LocalEnvironmentService {
  const filePath =
    options.filePath ??
    join(app.getPath("userData"), "local-environments.json");
  const now = options.now ?? (() => Date.now());
  const realpathFn = options.realpath ?? fsRealpath;
  const processEnvironment = options.processEnvironment;

  const stateStore = createLocalEnvironmentStateStore(filePath);
  const readState = stateStore.readState;
  const mutateState = stateStore.mutateState;

  async function safeRealpath(p: string): Promise<string> {
    try {
      return await realpathFn(p);
    } catch {
      return resolve(p);
    }
  }

  async function assertNotPierHome(path: string): Promise<void> {
    if (options.isPierHomeRoot && (await options.isPierHomeRoot(path))) {
      throw new LocalEnvironmentServiceError(
        "Pier Home cannot be managed as a normal project",
        "pier_home_forbidden"
      );
    }
  }

  async function readWireProject(
    entry: LocalEnvironmentIndexEntry
  ): Promise<LocalEnvironmentProject> {
    const kind = entryKind(entry);
    if (kind === "pier-home") {
      // Never read/write `.pier/environment.json` for Home.
      return defaultWireProject(entry.projectRootPath, "pier-home");
    }
    const file = await readProjectFile(entry.projectRootPath);
    return file
      ? toWireProject(entry.projectRootPath, file, kind)
      : defaultWireProject(entry.projectRootPath, kind);
  }

  async function composeState(
    global: LocalEnvironmentGlobalState
  ): Promise<LocalEnvironmentState> {
    const projects = await Promise.all(
      global.projects.map((entry) => readWireProject(entry))
    );
    return {
      projects,
      version: global.version,
      worktreeBindings: global.worktreeBindings,
    };
  }

  const service: LocalEnvironmentService = {
    async addProject(
      request: EnvironmentProjectRequest
    ): Promise<LocalEnvironmentState> {
      const projectRootPath = await realpathFn(request.projectRootPath);
      await assertNotPierHome(projectRootPath);
      // 全局注册: 幂等.
      const global = await mutateState((state) => {
        const existing = findIndexEntry(state, projectRootPath);
        if (existing) {
          return state;
        }
        return {
          ...state,
          projects: [
            ...state.projects,
            { kind: "project" as const, projectRootPath },
          ],
        };
      });
      // 文件不存在则 seed 默认; 存在则保留用户已有内容 (支持团队 git 里预置文件的场景).
      const existing = await readProjectFile(projectRootPath);
      if (!existing) {
        await writeProjectFile(projectRootPath, seedProjectFile(now));
      }
      return composeState(global);
    },

    async bindWorktree(request: {
      projectRootPath: string;
      worktreePath: string;
    }): Promise<void> {
      const projectRootPath = await safeRealpath(request.projectRootPath);
      await assertNotPierHome(projectRootPath);
      const state = await readState();
      const entry = findIndexEntry(state, projectRootPath);
      if (entryKind(entry) === "pier-home") {
        throw new LocalEnvironmentServiceError(
          "Pier Home cannot be bound as a worktree project",
          "pier_home_forbidden"
        );
      }
      const worktreePath = await safeRealpath(request.worktreePath);
      await mutateState((next) => {
        const filtered = next.worktreeBindings.filter(
          (b) => b.worktreePath !== worktreePath
        );
        return {
          ...next,
          worktreeBindings: [
            ...filtered,
            {
              createdAt: now(),
              projectRootPath,
              worktreePath,
            },
          ],
        };
      });
    },

    async clearWorktreeBinding(worktreePath: string): Promise<void> {
      const normalized = await safeRealpath(worktreePath);
      await mutateState((state) => ({
        ...state,
        worktreeBindings: state.worktreeBindings.filter(
          (b) => b.worktreePath !== normalized
        ),
      }));
    },

    async getProjectKind(
      projectRootPath: string
    ): Promise<LocalEnvironmentProjectKind | null> {
      const state = await readState();
      const normalized = await safeRealpath(projectRootPath);
      const entry = findIndexEntry(state, normalized);
      if (!entry) return null;
      return entryKind(entry);
    },

    async projectSnapshot(
      projectRootPath: string
    ): Promise<LocalEnvironmentProject | null> {
      const state = await readState();
      const normalized = await safeRealpath(projectRootPath);
      const entry = findIndexEntry(state, normalized);
      if (!entry) {
        return null;
      }
      return await readWireProject(entry);
    },

    async removeProject(
      request: EnvironmentProjectRequest
    ): Promise<LocalEnvironmentState> {
      const projectRootPath = await safeRealpath(request.projectRootPath);
      const before = await readState();
      const entry = findIndexEntry(before, projectRootPath);
      if (entryKind(entry) === "pier-home") {
        throw new LocalEnvironmentServiceError(
          "Pier Home cannot be removed from the project list",
          "pier_home_forbidden"
        );
      }
      await assertNotPierHome(projectRootPath);
      const global = await mutateState((state) => ({
        ...state,
        projects: state.projects.filter(
          (p) => p.projectRootPath !== projectRootPath
        ),
        worktreeBindings: state.worktreeBindings.filter(
          (b) => b.projectRootPath !== projectRootPath
        ),
      }));
      // 一并删项目文件, 保持"unregister 即彻底移除"的一致性.
      try {
        await deleteProjectFile(projectRootPath);
      } catch (err) {
        console.warn(
          "[local-environments] deleteProjectFile failed",
          { projectRootPath },
          err
        );
      }
      return composeState(global);
    },

    async resolveProject(
      projectRootPath: string
    ): Promise<LocalEnvironmentProject | null> {
      // 生命周期路径: 完全绕过全局注册, 以 .pier/environment.json 存在与否为准.
      const normalized = await safeRealpath(projectRootPath);
      if (
        options.isPierHomeRoot &&
        (await options.isPierHomeRoot(normalized))
      ) {
        return null;
      }
      const file = await readProjectFile(normalized);
      if (!file) {
        return null;
      }
      return toWireProject(normalized, file, "project");
    },

    async resolveForWorktree(worktreePath: string): Promise<{
      project: LocalEnvironmentProject;
      projectRootPath: string;
    } | null> {
      const state = await readState();
      const normalized = await safeRealpath(worktreePath);
      const binding = state.worktreeBindings.find(
        (b) => b.worktreePath === normalized
      );
      if (!binding) {
        return null;
      }
      const entry = findIndexEntry(state, binding.projectRootPath);
      if (entryKind(entry) === "pier-home") {
        return null;
      }
      const file = await readProjectFile(binding.projectRootPath);
      if (!file) {
        return null;
      }
      return {
        project: toWireProject(binding.projectRootPath, file, "project"),
        projectRootPath: binding.projectRootPath,
      };
    },

    async runLifecycle(request: {
      cwd: string;
      project: LocalEnvironmentProject;
      phase: LocalEnvironmentLifecyclePhase;
    }): Promise<void> {
      if (request.project.kind === "pier-home") {
        throw new LocalEnvironmentServiceError(
          "Pier Home has no environment scripts",
          "pier_home_forbidden"
        );
      }
      await runLocalEnvironmentLifecycle(
        options.spawn
          ? { ...request, processEnvironment, spawn: options.spawn }
          : { ...request, processEnvironment }
      );
    },

    async snapshot(
      request?: EnvironmentSnapshotRequest
    ): Promise<LocalEnvironmentState> {
      const global = await readState();
      if (request?.projectRootPath) {
        const normalized = await safeRealpath(request.projectRootPath);
        const entry = findIndexEntry(global, normalized);
        if (!entry) {
          return {
            projects: [],
            version: global.version,
            worktreeBindings: global.worktreeBindings,
          };
        }
        return {
          projects: [await readWireProject(entry)],
          version: global.version,
          worktreeBindings: global.worktreeBindings,
        };
      }
      return composeState(global);
    },

    async updateProject(
      request: EnvironmentUpdateRequest
    ): Promise<LocalEnvironmentState> {
      const projectRootPath = await safeRealpath(request.projectRootPath);
      const global = await readState();
      const entry = findIndexEntry(global, projectRootPath);
      if (!entry) {
        throw new LocalEnvironmentServiceError(
          `project not found: ${projectRootPath}`
        );
      }
      if (entryKind(entry) === "pier-home") {
        throw new LocalEnvironmentServiceError(
          "Pier Home has no environment scripts",
          "pier_home_forbidden"
        );
      }

      const trimmedSetup = request.setupCommand.trim();
      const trimmedCleanup = request.cleanupCommand.trim();

      const cleanedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.env)) {
        const trimmedKey = key.trim();
        if (trimmedKey) {
          cleanedEnv[trimmedKey] = value.trim();
        }
      }

      const cleanedPatterns: string[] = [];
      const seenPatterns = new Set<string>();
      for (const pattern of request.copyPatterns) {
        const trimmed = pattern.trim();
        if (trimmed && !seenPatterns.has(trimmed)) {
          seenPatterns.add(trimmed);
          cleanedPatterns.push(trimmed);
        }
      }

      const nextFile: LocalEnvironmentProjectFile = {
        cleanupCommand: trimmedCleanup,
        copyPatterns: cleanedPatterns,
        env: cleanedEnv,
        setupCommand: trimmedSetup,
        updatedAt: now(),
        version: 1,
      };
      await writeProjectFile(projectRootPath, nextFile);

      return composeState(global);
    },

    async upsertPierHome(
      projectRootPath: string
    ): Promise<LocalEnvironmentState> {
      const normalized = await safeRealpath(projectRootPath);
      const global = await mutateState((state) => {
        const existing = findIndexEntry(state, normalized);
        if (existing?.kind === "pier-home") {
          return state;
        }
        const without = state.projects.filter(
          (p) => p.projectRootPath !== normalized
        );
        return {
          ...state,
          projects: [
            { kind: "pier-home" as const, projectRootPath: normalized },
            ...without,
          ],
        };
      });
      return composeState(global);
    },

    async worktreeBinding(
      request: EnvironmentWorktreeBindingRequest
    ): Promise<LocalEnvironmentWorktreeBindingSnapshot | null> {
      const state = await readState();
      const normalized = await safeRealpath(request.worktreePath);
      const binding = state.worktreeBindings.find(
        (b) => b.worktreePath === normalized
      );
      if (!binding) {
        return null;
      }
      const entry = findIndexEntry(state, binding.projectRootPath);
      if (entryKind(entry) === "pier-home") {
        return null;
      }
      const file = await readProjectFile(binding.projectRootPath);
      if (!file) {
        return null;
      }

      return {
        cleanupCommand: file.cleanupCommand,
        copyPatterns: file.copyPatterns,
        env: file.env,
        hasCleanupScript: file.cleanupCommand.trim() !== "",
        projectRootPath: binding.projectRootPath,
        setupCommand: file.setupCommand,
        worktreePath: binding.worktreePath,
      };
    },
  };

  return service;
}
