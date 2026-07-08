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
import type { ProcessEnvironmentService } from "./process-environment-service.ts";

export class LocalEnvironmentServiceError extends Error {
  readonly reason = "project_not_found" as const;
  constructor(message: string) {
    super(message);
    this.name = "LocalEnvironmentServiceError";
  }
}

/**
 * 新项目首次 Add 时写入 `.pier/environment.json` 的默认 copyPatterns.
 * `.env*` 跨技术栈通用; 其他 stack-specific 的 pattern (Vite `*.local`,
 * Claude `.claude/settings.local.json` 等) 由用户或对应插件按需追加,
 * 主体保持中立.
 */
const DEFAULT_PROJECT_COPY_PATTERNS = [".env*"];

export interface LocalEnvironmentService {
  addProject(
    request: EnvironmentProjectRequest
  ): Promise<LocalEnvironmentState>;
  bindWorktree(request: {
    projectRootPath: string;
    worktreePath: string;
  }): Promise<void>;
  clearWorktreeBinding(worktreePath: string): Promise<void>;
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
  worktreeBinding(
    request: EnvironmentWorktreeBindingRequest
  ): Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
}

export function createLocalEnvironmentService(options: {
  filePath?: string;
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

  function findIndexEntry(
    state: LocalEnvironmentGlobalState,
    projectRootPath: string
  ): LocalEnvironmentIndexEntry | undefined {
    return state.projects.find((p) => p.projectRootPath === projectRootPath);
  }

  /** File shape (no projectRootPath) → wire shape (with projectRootPath). */
  function toWireProject(
    projectRootPath: string,
    file: LocalEnvironmentProjectFile
  ): LocalEnvironmentProject {
    return {
      cleanupCommand: file.cleanupCommand,
      copyPatterns: file.copyPatterns,
      env: file.env,
      projectRootPath,
      setupCommand: file.setupCommand,
      updatedAt: file.updatedAt,
    };
  }

  /** File missing 时给 UI 的降级默认 (registered 但配置暂时不存在). */
  function defaultWireProject(
    projectRootPath: string
  ): LocalEnvironmentProject {
    return {
      cleanupCommand: "",
      copyPatterns: [],
      env: {},
      projectRootPath,
      setupCommand: "",
      updatedAt: 0,
    };
  }

  function seedProjectFile(): LocalEnvironmentProjectFile {
    return {
      cleanupCommand: "",
      copyPatterns: [...DEFAULT_PROJECT_COPY_PATTERNS],
      env: {},
      setupCommand: "",
      updatedAt: now(),
      version: 1,
    };
  }

  async function readWireProject(
    projectRootPath: string
  ): Promise<LocalEnvironmentProject> {
    const file = await readProjectFile(projectRootPath);
    return file
      ? toWireProject(projectRootPath, file)
      : defaultWireProject(projectRootPath);
  }

  async function composeState(
    global: LocalEnvironmentGlobalState
  ): Promise<LocalEnvironmentState> {
    const projects = await Promise.all(
      global.projects.map((entry) => readWireProject(entry.projectRootPath))
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
      // 全局注册: 幂等.
      const global = await mutateState((state) => {
        if (findIndexEntry(state, projectRootPath)) {
          return state;
        }
        return {
          ...state,
          projects: [...state.projects, { projectRootPath }],
        };
      });
      // 文件不存在则 seed 默认; 存在则保留用户已有内容 (支持团队 git 里预置文件的场景).
      const existing = await readProjectFile(projectRootPath);
      if (!existing) {
        await writeProjectFile(projectRootPath, seedProjectFile());
      }
      return composeState(global);
    },

    async bindWorktree(request: {
      projectRootPath: string;
      worktreePath: string;
    }): Promise<void> {
      const projectRootPath = await safeRealpath(request.projectRootPath);
      const worktreePath = await safeRealpath(request.worktreePath);
      await mutateState((state) => {
        const filtered = state.worktreeBindings.filter(
          (b) => b.worktreePath !== worktreePath
        );
        return {
          ...state,
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

    async projectSnapshot(
      projectRootPath: string
    ): Promise<LocalEnvironmentProject | null> {
      const state = await readState();
      const normalized = await safeRealpath(projectRootPath);
      if (!findIndexEntry(state, normalized)) {
        return null;
      }
      return await readWireProject(normalized);
    },

    async removeProject(
      request: EnvironmentProjectRequest
    ): Promise<LocalEnvironmentState> {
      const projectRootPath = await safeRealpath(request.projectRootPath);
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
      const file = await readProjectFile(normalized);
      if (!file) {
        return null;
      }
      return toWireProject(normalized, file);
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
      const file = await readProjectFile(binding.projectRootPath);
      if (!file) {
        return null;
      }
      return {
        project: toWireProject(binding.projectRootPath, file),
        projectRootPath: binding.projectRootPath,
      };
    },

    async runLifecycle(request: {
      cwd: string;
      project: LocalEnvironmentProject;
      phase: LocalEnvironmentLifecyclePhase;
    }): Promise<void> {
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
        if (!findIndexEntry(global, normalized)) {
          return {
            projects: [],
            version: global.version,
            worktreeBindings: global.worktreeBindings,
          };
        }
        return {
          projects: [await readWireProject(normalized)],
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
      if (!findIndexEntry(global, projectRootPath)) {
        throw new LocalEnvironmentServiceError(
          `project not found: ${projectRootPath}`
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
