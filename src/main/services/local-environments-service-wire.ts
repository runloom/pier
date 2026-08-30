import type {
  LocalEnvironmentProject,
  LocalEnvironmentProjectFile,
  LocalEnvironmentProjectKind,
} from "@shared/contracts/environment.ts";
import type {
  LocalEnvironmentGlobalState,
  LocalEnvironmentIndexEntry,
} from "./local-environment-store.ts";

export class LocalEnvironmentServiceError extends Error {
  readonly reason: "project_not_found" | "pier_home_forbidden";
  constructor(
    message: string,
    reason: "project_not_found" | "pier_home_forbidden" = "project_not_found"
  ) {
    super(message);
    this.name = "LocalEnvironmentServiceError";
    this.reason = reason;
  }
}

/**
 * 新项目首次 Add 时写入 `.pier/environment.json` 的默认 copyPatterns.
 * `.env*` 跨技术栈通用; 其他 stack-specific 的 pattern (Vite `*.local`,
 * Claude `.claude/settings.local.json` 等) 由用户或对应插件按需追加,
 * 主体保持中立.
 */
export const DEFAULT_PROJECT_COPY_PATTERNS = [".env*"];

export function findIndexEntry(
  state: { projects: LocalEnvironmentIndexEntry[] },
  projectRootPath: string
): LocalEnvironmentIndexEntry | undefined {
  return state.projects.find((p) => p.projectRootPath === projectRootPath);
}

export function entryKind(
  entry: LocalEnvironmentIndexEntry | undefined
): LocalEnvironmentProjectKind {
  return entry?.kind ?? "project";
}

/** File shape (no projectRootPath) → wire shape (with projectRootPath). */
export function toWireProject(
  projectRootPath: string,
  file: LocalEnvironmentProjectFile,
  kind: LocalEnvironmentProjectKind = "project"
): LocalEnvironmentProject {
  return {
    cleanupCommand: file.cleanupCommand,
    copyPatterns: file.copyPatterns,
    env: file.env,
    kind,
    projectRootPath,
    setupCommand: file.setupCommand,
    updatedAt: file.updatedAt,
  };
}

/** File missing 时给 UI 的降级默认 (registered 但配置暂时不存在). */
export function defaultWireProject(
  projectRootPath: string,
  kind: LocalEnvironmentProjectKind = "project"
): LocalEnvironmentProject {
  return {
    cleanupCommand: "",
    copyPatterns: [],
    env: {},
    kind,
    projectRootPath,
    setupCommand: "",
    updatedAt: 0,
  };
}

export function seedProjectFile(
  now: () => number
): LocalEnvironmentProjectFile {
  return {
    cleanupCommand: "",
    copyPatterns: [...DEFAULT_PROJECT_COPY_PATTERNS],
    env: {},
    setupCommand: "",
    updatedAt: now(),
    version: 1,
  };
}

/**
 * Register the git primary checkout. Collapse only the picked worktree (if
 * it was a first-class project row) and bind that path to main. Sibling
 * worktrees the user did not pick keep their rows and bindings.
 */
export function applyCanonicalProjectRegistration(
  state: LocalEnvironmentGlobalState,
  input: {
    canonicalPath: string;
    now: number;
    pickedPath: string;
  }
): LocalEnvironmentGlobalState {
  const pickedIsLinked = input.pickedPath !== input.canonicalPath;
  const projects = state.projects.filter((entry) => {
    if (entry.kind === "pier-home") {
      return true;
    }
    if (entry.projectRootPath === input.canonicalPath) {
      return true;
    }
    return !(pickedIsLinked && entry.projectRootPath === input.pickedPath);
  });
  const hasCanonical = projects.some(
    (entry) => entry.projectRootPath === input.canonicalPath
  );
  const nextProjects = hasCanonical
    ? projects
    : [
        ...projects,
        { kind: "project" as const, projectRootPath: input.canonicalPath },
      ];

  const worktreeBindings = state.worktreeBindings.filter(
    (binding) => binding.worktreePath !== input.pickedPath
  );
  if (pickedIsLinked) {
    worktreeBindings.push({
      createdAt: input.now,
      projectRootPath: input.canonicalPath,
      worktreePath: input.pickedPath,
    });
  }

  return {
    ...state,
    projects: nextProjects,
    worktreeBindings,
  };
}
