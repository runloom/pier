import { existsSync } from "node:fs";
import {
  realpath as fsRealpath,
  lstat,
  mkdir,
  readFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AssetRootRef,
  RuleFileId,
  RuleFileView,
  RulesReadResult,
  RulesSnapshot,
} from "@shared/contracts/agent-assets.ts";
import writeFileAtomic from "write-file-atomic";
import {
  FilePathIdentityError,
  isMissingPathError,
  resolveExistingFileIdentity,
  resolveWritableFileIdentity,
} from "../file-path-identity.ts";
import type { LocalEnvironmentService } from "../local-environments-service.ts";
import type { PierHomeService } from "../pier-home/service.ts";

export const RULES_MAX_BYTES = 512 * 1024;

const RULE_FILES: ReadonlyArray<{
  id: RuleFileId;
  relativePath: string;
  canEnsure: boolean;
  template: string;
}> = [
  {
    id: "agents-md",
    relativePath: "AGENTS.md",
    canEnsure: true,
    template: `# AGENTS.md

## Guidance

Add always-on rules for coding agents working in this scope.
`,
  },
  {
    id: "claude-md",
    relativePath: "CLAUDE.md",
    canEnsure: true,
    template: `# CLAUDE.md

## Project instructions

Add always-on guidance for Claude Code.
`,
  },
  {
    id: "gemini-md",
    relativePath: "GEMINI.md",
    canEnsure: true,
    template: `# GEMINI.md

## Project instructions

Add always-on guidance for Gemini CLI.
`,
  },
  {
    id: "cursor-rules",
    relativePath: ".cursor/rules",
    canEnsure: false,
    template: "",
  },
];

export class AgentRulesServiceError extends Error {
  readonly reason:
    | "not_found"
    | "forbidden"
    | "too_large"
    | "not_a_file"
    | "ensure_unsupported";
  constructor(
    message: string,
    reason: AgentRulesServiceError["reason"] = "forbidden"
  ) {
    super(message);
    this.name = "AgentRulesServiceError";
    this.reason = reason;
  }
}

export interface AgentRulesService {
  ensure(root: AssetRootRef, id: RuleFileId): Promise<RulesSnapshot>;
  read(root: AssetRootRef, id: RuleFileId): Promise<RulesReadResult>;
  snapshot(root: AssetRootRef): Promise<RulesSnapshot>;
  write(
    root: AssetRootRef,
    id: RuleFileId,
    content: string
  ): Promise<RulesSnapshot>;
}

function mapIdentityError(err: unknown): never {
  if (err instanceof AgentRulesServiceError) throw err;
  if (err instanceof FilePathIdentityError) {
    throw new AgentRulesServiceError(err.message, "forbidden");
  }
  throw err;
}

export function createAgentRulesService(options: {
  localEnvironments: LocalEnvironmentService;
  pierHome: PierHomeService;
  realpath?: (path: string) => Promise<string>;
}): AgentRulesService {
  const realpathFn = options.realpath ?? fsRealpath;

  async function safeRealpath(p: string): Promise<string> {
    try {
      return await realpathFn(p);
    } catch (err) {
      if (isMissingPathError(err)) {
        throw new AgentRulesServiceError(`path not found: ${p}`, "not_found");
      }
      throw err;
    }
  }

  async function resolveRoot(root: AssetRootRef): Promise<{
    rootPath: string;
    scope: "project" | "home";
  }> {
    if (root.scope === "home") {
      const info = await options.pierHome.ensure();
      return { rootPath: info.rootPath, scope: "home" };
    }
    let normalized: string;
    try {
      normalized = await safeRealpath(root.projectRootPath);
    } catch (err) {
      if (err instanceof AgentRulesServiceError) throw err;
      throw err;
    }
    if (await options.pierHome.isHomeRoot(normalized)) {
      throw new AgentRulesServiceError(
        "Pier Home must use scope home, not project",
        "forbidden"
      );
    }
    const kind = await options.localEnvironments.getProjectKind(normalized);
    if (kind === "pier-home") {
      throw new AgentRulesServiceError(
        "Pier Home must use scope home, not project",
        "forbidden"
      );
    }
    if (kind !== "project") {
      throw new AgentRulesServiceError(
        "project scope requires a registered Pier project",
        "forbidden"
      );
    }
    if (!existsSync(normalized)) {
      throw new AgentRulesServiceError(
        `project root not found: ${normalized}`,
        "not_found"
      );
    }
    return { rootPath: normalized, scope: "project" };
  }

  function mappingFor(id: RuleFileId) {
    const entry = RULE_FILES.find((f) => f.id === id);
    if (!entry) {
      throw new AgentRulesServiceError(`unknown rule file: ${id}`, "not_found");
    }
    return entry;
  }

  async function inspectFile(
    rootPath: string,
    relativePath: string
  ): Promise<RuleFileView> {
    const mapped = RULE_FILES.find((f) => f.relativePath === relativePath);
    if (!mapped) {
      throw new AgentRulesServiceError(
        `unknown rule path: ${relativePath}`,
        "not_found"
      );
    }
    const { id } = mapped;
    const absolute = join(rootPath, ...relativePath.split("/"));
    try {
      const fileStat = await lstat(absolute);
      if (fileStat.isSymbolicLink()) {
        return { id, relativePath, state: "other" };
      }
      if (fileStat.isDirectory() || fileStat.isFile()) {
        try {
          await resolveExistingFileIdentity(rootPath, relativePath);
        } catch (err) {
          if (err instanceof FilePathIdentityError) {
            return { id, relativePath, state: "other" };
          }
          throw err;
        }
      }
      if (fileStat.isDirectory()) {
        return {
          id,
          relativePath,
          state: "directory",
          updatedAt: Math.trunc(fileStat.mtimeMs),
        };
      }
      if (fileStat.isFile()) {
        return {
          id,
          relativePath,
          state: "file",
          sizeBytes: fileStat.size,
          updatedAt: Math.trunc(fileStat.mtimeMs),
        };
      }
      return { id, relativePath, state: "other" };
    } catch (err) {
      if (isMissingPathError(err)) {
        return { id, relativePath, state: "missing" };
      }
      throw err;
    }
  }

  return {
    async snapshot(root) {
      const { rootPath, scope } = await resolveRoot(root);
      const files = await Promise.all(
        RULE_FILES.map((f) => inspectFile(rootPath, f.relativePath))
      );
      return { files, rootPath, scope };
    },

    async read(root, id) {
      const mapping = mappingFor(id);
      const { rootPath } = await resolveRoot(root);
      const view = await inspectFile(rootPath, mapping.relativePath);
      if (view.state === "missing") {
        throw new AgentRulesServiceError(
          `${mapping.relativePath} is missing`,
          "not_found"
        );
      }
      if (view.state !== "file") {
        throw new AgentRulesServiceError(
          `${mapping.relativePath} is not a file`,
          "not_a_file"
        );
      }
      let absolute: string;
      try {
        const identity = await resolveExistingFileIdentity(
          rootPath,
          mapping.relativePath
        );
        absolute = identity.canonicalTarget;
      } catch (err) {
        mapIdentityError(err);
      }
      const buf = await readFile(absolute);
      if (buf.byteLength > RULES_MAX_BYTES) {
        return {
          content: buf.subarray(0, RULES_MAX_BYTES).toString("utf8"),
          id,
          relativePath: mapping.relativePath,
          truncated: true,
        };
      }
      return {
        content: buf.toString("utf8"),
        id,
        relativePath: mapping.relativePath,
        truncated: false,
      };
    },

    async write(root, id, content) {
      const mapping = mappingFor(id);
      const { rootPath } = await resolveRoot(root);
      if (Buffer.byteLength(content, "utf8") > RULES_MAX_BYTES) {
        throw new AgentRulesServiceError(
          "file exceeds 512 KiB limit",
          "too_large"
        );
      }
      // Write never creates: missing files go through ensure (canEnsure only).
      let absolute: string;
      try {
        const identity = await resolveExistingFileIdentity(
          rootPath,
          mapping.relativePath
        );
        const lexical = await lstat(identity.lexicalTarget);
        if (lexical.isSymbolicLink() || !identity.stat.isFile()) {
          throw new AgentRulesServiceError(
            "refusing to replace non-file",
            "not_a_file"
          );
        }
        if (identity.stat.size > RULES_MAX_BYTES) {
          throw new AgentRulesServiceError(
            "file exceeds 512 KiB limit; edit externally",
            "too_large"
          );
        }
        absolute = identity.canonicalTarget;
      } catch (err) {
        if (isMissingPathError(err)) {
          throw new AgentRulesServiceError(
            `${mapping.relativePath} is missing; create it first`,
            "not_found"
          );
        }
        mapIdentityError(err);
      }
      await writeFileAtomic(absolute, content, "utf8");
      return this.snapshot(root);
    },

    async ensure(root, id) {
      const mapping = mappingFor(id);
      if (!mapping.canEnsure) {
        throw new AgentRulesServiceError(
          `${mapping.relativePath} does not support ensure`,
          "ensure_unsupported"
        );
      }
      const { rootPath } = await resolveRoot(root);
      const view = await inspectFile(rootPath, mapping.relativePath);
      if (view.state === "file") {
        return this.snapshot(root);
      }
      if (view.state !== "missing") {
        throw new AgentRulesServiceError(
          `${mapping.relativePath} exists but is not a creatable file`,
          "not_a_file"
        );
      }
      let absolute: string;
      try {
        const identity = await resolveWritableFileIdentity(
          rootPath,
          mapping.relativePath
        );
        if (identity.exists) {
          return this.snapshot(root);
        }
        absolute = identity.canonicalTarget;
      } catch (err) {
        mapIdentityError(err);
      }
      await mkdir(dirname(absolute), { recursive: true });
      await writeFileAtomic(absolute, mapping.template, "utf8");
      return this.snapshot(root);
    },
  };
}
