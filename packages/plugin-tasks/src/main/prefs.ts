import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod/mini";
import type { SourceSnapshot, TaskProvider } from "../shared/types.ts";

const providerSchema = z.enum(["github", "linear", "jira"]);

const projectPrefSchema = z.object({
  lastJiraProject: z.optional(z.string()),
  lastLinearProject: z.optional(z.string()),
  lastLinearTeam: z.optional(z.string()),
  lastSource: providerSchema,
  originRepo: z.optional(z.string()),
});

const fileSchema = z.object({
  jiraProjectKeys: z.optional(z.array(z.string())),
  linearTeamKeys: z.optional(z.array(z.string())),
  projects: z.optional(z.record(z.string(), projectPrefSchema)),
});

const legacyBindingSchema = z.object({
  provider: z.optional(providerSchema),
  repo: z.string(),
});

const legacyListFileSchema = z.object({
  projects: z.record(
    z.string(),
    z.object({
      connections: z.array(
        z.object({
          provider: z.optional(providerSchema),
          repo: z.string(),
        })
      ),
      defaultId: z.optional(z.string()),
      originRepo: z.optional(z.string()),
    })
  ),
});

const legacyMapFileSchema = z.object({
  bindings: z.record(z.string(), legacyBindingSchema),
});

export interface ProjectSourcePref {
  lastJiraProject?: string | undefined;
  lastLinearProject?: string | undefined;
  lastLinearTeam?: string | undefined;
  lastSource: TaskProvider;
  originRepo?: string | undefined;
}

export interface SourcePrefsStore {
  detectRemote(projectRootPath: string): Promise<string | null>;
  findProjectRootByOrigin(repo: string): Promise<string | null>;
  get(projectRootPath: string): Promise<SourceSnapshot>;
  lastTouchedPath(): string | null;
  onChange(listener: (projectRootPath: string) => void): () => void;
  setJiraProjectKeys(keys: readonly string[]): Promise<SourceSnapshot>;
  setLastJiraProject(
    projectRootPath: string,
    key: string
  ): Promise<SourceSnapshot>;
  setLastLinearProject(
    projectRootPath: string,
    id: string | null
  ): Promise<SourceSnapshot>;
  setLastLinearTeam(
    projectRootPath: string,
    key: string
  ): Promise<SourceSnapshot>;
  setLastSource(
    projectRootPath: string,
    source: TaskProvider
  ): Promise<SourceSnapshot>;
  setLinearTeamKeys(keys: readonly string[]): Promise<SourceSnapshot>;
}

interface StoredPrefs {
  jiraProjectKeys: string[];
  linearTeamKeys: string[];
  projects: Record<string, ProjectSourcePref>;
}

const EMPTY_PREF: ProjectSourcePref = { lastSource: "github" };

export function createSourcePrefsStore(input: {
  detectRemote?: (projectRootPath: string) => Promise<string | null>;
  filePath: string;
}): SourcePrefsStore {
  const detectRemote = input.detectRemote ?? detectGitHubRemote;
  let cache: StoredPrefs | null = null;
  let lastTouched: string | null = null;
  const listeners = new Set<(projectRootPath: string) => void>();

  const load = async (): Promise<StoredPrefs> => {
    if (cache) {
      return cache;
    }
    cache = await readPrefs(input.filePath);
    return cache;
  };

  const persist = async (prefs: StoredPrefs) => {
    await mkdir(dirname(input.filePath), { recursive: true });
    await writeFileAtomic(
      input.filePath,
      `${JSON.stringify(prefs, null, 2)}\n`,
      "utf8"
    );
    cache = prefs;
  };

  const notify = (projectRootPath: string) => {
    for (const listener of listeners) {
      listener(projectRootPath);
    }
  };

  const snapshotOf = async (
    projectRootPath: string,
    prefs: StoredPrefs
  ): Promise<SourceSnapshot> => {
    const key = await resolveProjectKey(
      projectRootPath,
      prefs.projects,
      detectRemote
    );
    const project = prefs.projects[key] ?? EMPTY_PREF;
    const githubRepo = await detectRemote(projectRootPath);
    return {
      githubRepo,
      jiraProjectKeys: prefs.jiraProjectKeys,
      lastJiraProject: project.lastJiraProject ?? null,
      lastLinearProject: project.lastLinearProject ?? null,
      lastLinearTeam: project.lastLinearTeam ?? null,
      lastSource: project.lastSource,
      linearTeamKeys: prefs.linearTeamKeys,
    };
  };

  const mutateProject = async (
    projectRootPath: string,
    update: (current: ProjectSourcePref) => ProjectSourcePref
  ): Promise<SourceSnapshot> => {
    const prefs = clonePrefs(await load());
    const key = await resolveProjectKey(
      projectRootPath,
      prefs.projects,
      detectRemote
    );
    const origin = await detectRemote(key);
    const current = prefs.projects[key] ?? EMPTY_PREF;
    prefs.projects[key] = {
      ...update(current),
      ...(origin ? { originRepo: origin } : {}),
    };
    await persist(prefs);
    notify(key);
    if (key !== projectRootPath) {
      notify(projectRootPath);
    }
    return snapshotOf(projectRootPath, prefs);
  };

  return {
    detectRemote,
    async findProjectRootByOrigin(repo) {
      const prefs = await load();
      return projectRootForOrigin(prefs.projects, repo);
    },
    async get(projectRootPath) {
      const prefs = await load();
      const path =
        projectRootPath || lastTouched || Object.keys(prefs.projects)[0] || "";
      if (path) {
        lastTouched = await resolveProjectKey(
          path,
          prefs.projects,
          detectRemote
        );
      }
      return snapshotOf(path, prefs);
    },
    lastTouchedPath: () => lastTouched,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async setLinearTeamKeys(keys) {
      const prefs = clonePrefs(await load());
      prefs.linearTeamKeys = uniqueKeys(keys);
      await persist(prefs);
      notify("");
      return snapshotOf("", prefs);
    },
    async setJiraProjectKeys(keys) {
      const prefs = clonePrefs(await load());
      prefs.jiraProjectKeys = uniqueKeys(keys);
      await persist(prefs);
      notify("");
      return snapshotOf("", prefs);
    },
    setLastSource(projectRootPath, source) {
      return mutateProject(projectRootPath, (current) => ({
        ...current,
        lastSource: source,
      }));
    },
    setLastLinearTeam(projectRootPath, key) {
      return mutateProject(projectRootPath, (current) => ({
        ...current,
        lastLinearProject: undefined,
        lastLinearTeam: key,
        lastSource: "linear",
      }));
    },
    setLastLinearProject(projectRootPath, id) {
      return mutateProject(projectRootPath, (current) => ({
        ...current,
        lastLinearProject: id && id.length > 0 ? id : undefined,
        lastSource: "linear",
      }));
    },
    setLastJiraProject(projectRootPath, key) {
      return mutateProject(projectRootPath, (current) => ({
        ...current,
        lastJiraProject: key,
        lastSource: "jira",
      }));
    },
  };
}

function clonePrefs(prefs: StoredPrefs): StoredPrefs {
  return {
    jiraProjectKeys: [...prefs.jiraProjectKeys],
    linearTeamKeys: [...prefs.linearTeamKeys],
    projects: { ...prefs.projects },
  };
}

function uniqueKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (key.length === 0) {
      continue;
    }
    const id = key.toLowerCase();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(key);
  }
  return result;
}

async function readPrefs(filePath: string): Promise<StoredPrefs> {
  try {
    const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (isLegacyPrefs(raw)) {
      return migrateLegacy(raw);
    }
    const current = fileSchema.safeParse(raw);
    if (!current.success) {
      return { jiraProjectKeys: [], linearTeamKeys: [], projects: {} };
    }
    return {
      jiraProjectKeys: current.data.jiraProjectKeys ?? [],
      linearTeamKeys: current.data.linearTeamKeys ?? [],
      projects: current.data.projects ?? {},
    };
  } catch {
    return { jiraProjectKeys: [], linearTeamKeys: [], projects: {} };
  }
}

function isLegacyPrefs(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  if ("bindings" in raw) {
    return true;
  }
  if (
    !("projects" in raw && raw.projects) ||
    typeof raw.projects !== "object"
  ) {
    return false;
  }
  return Object.values(raw.projects).some(
    (project) =>
      project && typeof project === "object" && "connections" in project
  );
}

function migrateLegacy(raw: unknown): StoredPrefs {
  const list = legacyListFileSchema.safeParse(raw);
  if (list.success) {
    return migrateConnectionList(list.data.projects);
  }
  const map = legacyMapFileSchema.safeParse(raw);
  if (map.success) {
    return migrateBindingMap(map.data.bindings);
  }
  return { jiraProjectKeys: [], linearTeamKeys: [], projects: {} };
}

function migrateConnectionList(
  projects: Record<
    string,
    {
      connections: Array<{
        provider?: TaskProvider | undefined;
        repo: string;
      }>;
      originRepo?: string | undefined;
    }
  >
): StoredPrefs {
  const linearTeamKeys: string[] = [];
  const jiraProjectKeys: string[] = [];
  const next: Record<string, ProjectSourcePref> = {};
  for (const [path, project] of Object.entries(projects)) {
    const defaultConn = project.connections[0];
    const lastSource = defaultConn?.provider ?? "github";
    let lastLinearTeam: string | undefined;
    let lastJiraProject: string | undefined;
    let originRepo = project.originRepo;
    for (const connection of project.connections) {
      const provider = connection.provider ?? "github";
      if (provider === "linear") {
        linearTeamKeys.push(connection.repo);
        lastLinearTeam = lastLinearTeam ?? connection.repo;
      } else if (provider === "jira") {
        jiraProjectKeys.push(connection.repo);
        lastJiraProject = lastJiraProject ?? connection.repo;
      } else if (
        !originRepo &&
        parseGitHubRepo(`https://github.com/${connection.repo}`)
      ) {
        originRepo = connection.repo;
      }
    }
    next[path] = {
      lastSource,
      ...(lastLinearTeam ? { lastLinearTeam } : {}),
      ...(lastJiraProject ? { lastJiraProject } : {}),
      ...(originRepo ? { originRepo } : {}),
    };
  }
  return {
    jiraProjectKeys: uniqueKeys(jiraProjectKeys),
    linearTeamKeys: uniqueKeys(linearTeamKeys),
    projects: next,
  };
}

function migrateBindingMap(
  bindings: Record<
    string,
    { provider?: TaskProvider | undefined; repo: string }
  >
): StoredPrefs {
  return migrateConnectionList(
    Object.fromEntries(
      Object.entries(bindings).map(([path, binding]) => [
        path,
        { connections: [binding] },
      ])
    )
  );
}

async function resolveProjectKey(
  projectRootPath: string,
  projects: Record<string, ProjectSourcePref>,
  detectRemote: (projectRootPath: string) => Promise<string | null>
): Promise<string> {
  if (!projectRootPath) {
    return projectRootPath;
  }
  if (projects[projectRootPath]) {
    return projectRootPath;
  }
  const trimmed = projectRootPath.replace(/\/+$/, "");
  if (projects[trimmed]) {
    return trimmed;
  }
  const remote = await detectRemote(projectRootPath);
  if (!remote) {
    return projectRootPath;
  }
  return projectRootForOrigin(projects, remote) ?? projectRootPath;
}

function projectRootForOrigin(
  projects: Record<string, ProjectSourcePref>,
  origin: string
): string | null {
  const needle = origin.trim().toLowerCase();
  for (const [projectRootPath, project] of Object.entries(projects)) {
    if (project.originRepo?.trim().toLowerCase() === needle) {
      return projectRootPath;
    }
  }
  return null;
}

async function detectGitHubRemote(
  projectRootPath: string
): Promise<string | null> {
  if (!projectRootPath) {
    return null;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const result = await execFileAsync(
      "git",
      ["-C", projectRootPath, "remote", "get-url", "origin"],
      { timeout: 5000 }
    );
    return parseGitHubRepo(result.stdout.trim());
  } catch {
    return null;
  }
}

export function parseGitHubRepo(remote: string): string | null {
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(remote);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`;
  }
  const https = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i.exec(
    remote
  );
  if (https) {
    return `${https[1]}/${https[2]}`;
  }
  return null;
}
