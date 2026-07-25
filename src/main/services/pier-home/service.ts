import { existsSync } from "node:fs";
import { realpath as fsRealpath, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PierHomeInfo } from "@shared/contracts/pier-home.ts";
import writeFileAtomic from "write-file-atomic";
import {
  createPierHomeSkillsLibrary,
  type PierHomeSkillsLibrary,
} from "./skills-library.ts";

const HOME_DIR_NAME = "pier-home";
const HOME_META_RELATIVE = join(".pier", "home.json");
const README_NAME = "README.md";
const CANVASES_DIR = "canvases";

const DEFAULT_README = `# Pier Home

This is Pier's private local workbench root (not your user home, and not
\`~/.agents\` / \`~/.claude\` discovery paths).

Use it for the Pier-owned skills library (\`skills/library\`) and (later)
canvases. Environment setup scripts do not apply here. Pier never writes
agent global discovery roots under \`~/\` from this folder.
`;

export interface PierHomeService {
  /** Ensure directory layout + return info. Idempotent. */
  ensure(): Promise<PierHomeInfo>;
  info(): Promise<PierHomeInfo>;
  /** realpath-aware comparison to the pier-home root. */
  isHomeRoot(path: string): Promise<boolean>;
  /** Sync absolute path under userData (may not exist yet). */
  rootPath(): string;
  /** Pier-owned skills library under pier-home/skills. */
  skills: PierHomeSkillsLibrary;
}

export function createPierHomeService(options: {
  userDataPath: string;
  now?: () => number;
  realpath?: (path: string) => Promise<string>;
  /**
   * Called after filesystem ensure so the environments index can upsert
   * `kind: "pier-home"` without seeding `.pier/environment.json`.
   */
  onEnsured?: (info: PierHomeInfo) => Promise<void>;
}): PierHomeService {
  const now = options.now ?? (() => Date.now());
  const realpathFn = options.realpath ?? fsRealpath;
  const root = join(options.userDataPath, HOME_DIR_NAME);
  const metaPath = join(root, HOME_META_RELATIVE);
  const readmePath = join(root, README_NAME);
  const canvasesPath = join(root, CANVASES_DIR);
  const skills = createPierHomeSkillsLibrary({
    homeRoot: root,
    now,
  });

  async function safeRealpath(p: string): Promise<string> {
    try {
      return await realpathFn(p);
    } catch {
      return resolve(p);
    }
  }

  async function readOrCreateMeta(createdAt: number): Promise<PierHomeInfo> {
    if (existsSync(metaPath)) {
      try {
        const raw = JSON.parse(await readFile(metaPath, "utf8")) as {
          createdAt?: unknown;
          kind?: unknown;
        };
        if (raw.kind === "pier-home" && typeof raw.createdAt === "number") {
          return {
            kind: "pier-home",
            rootPath: await safeRealpath(root),
            createdAt: raw.createdAt,
          };
        }
      } catch {
        // fall through and rewrite
      }
    }
    const info: PierHomeInfo = {
      kind: "pier-home",
      rootPath: await safeRealpath(root),
      createdAt,
    };
    await mkdir(join(root, ".pier"), { recursive: true });
    await writeFileAtomic(
      metaPath,
      `${JSON.stringify(
        { version: 1, kind: "pier-home", createdAt: info.createdAt },
        null,
        2
      )}\n`
    );
    return info;
  }

  return {
    skills,

    rootPath() {
      return root;
    },

    async isHomeRoot(path: string): Promise<boolean> {
      const [candidate, home] = await Promise.all([
        safeRealpath(path),
        safeRealpath(root),
      ]);
      return candidate === home;
    },

    async ensure(): Promise<PierHomeInfo> {
      await mkdir(root, { recursive: true });
      await mkdir(canvasesPath, { recursive: true });
      await mkdir(join(root, ".pier"), { recursive: true });
      await skills.ensureLayout();

      if (!existsSync(readmePath)) {
        await writeFileAtomic(readmePath, DEFAULT_README);
      }

      const info = await readOrCreateMeta(now());
      const resolved: PierHomeInfo = {
        ...info,
        rootPath: await safeRealpath(root),
      };
      await options.onEnsured?.(resolved);
      return resolved;
    },

    async info(): Promise<PierHomeInfo> {
      if (!existsSync(root)) {
        return this.ensure();
      }
      return readOrCreateMeta(now());
    },
  };
}
