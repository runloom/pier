import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PierHomeSkillDelivery,
  PierHomeSkillView,
} from "@shared/contracts/pier-home-skills.ts";
import {
  PIER_SYSTEM_SKILL_PREFIX,
  skillIdSchema,
} from "@shared/contracts/project-skills.ts";
import writeFileAtomic from "write-file-atomic";
import {
  parseSafeSkillFrontmatter,
  peekSkillMetadata,
  SKILL_FRONTMATTER_LIMITS,
} from "../project-skills/frontmatter.ts";

const CATALOG_NAME = "catalog.json";
const LIBRARY_DIR = "library";

const DEFAULT_ALWAYS_INCLUDE_DELIVERY: PierHomeSkillDelivery = {
  agents: true,
  claude: false,
};

interface CatalogEntry {
  alwaysInclude: boolean;
  createdAt: number;
  /** Present when alwaysInclude; ignored otherwise. */
  delivery?: PierHomeSkillDelivery;
  id: string;
  updatedAt: number;
}

interface CatalogFile {
  schemaVersion: 1;
  skills: CatalogEntry[];
}

export class PierHomeSkillsError extends Error {
  readonly code:
    | "invalid-skill-id"
    | "reserved-prefix"
    | "skill-exists"
    | "skill-missing"
    | "skill-md-invalid"
    | "skill-md-too-large";

  constructor(
    code: PierHomeSkillsError["code"],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PierHomeSkillsError";
    this.code = code;
  }
}

export interface PierHomeAlwaysIncludeSkill {
  delivery: PierHomeSkillDelivery;
  id: string;
}

export interface PierHomeSkillsLibrary {
  contentDir(skillId: string): string;
  create(args: {
    skillId: string;
    description?: string;
    alwaysInclude?: boolean;
    delivery?: PierHomeSkillDelivery;
  }): Promise<PierHomeSkillView>;
  delete(skillId: string): Promise<void>;
  ensureLayout(): Promise<void>;
  list(): Promise<PierHomeSkillView[]>;
  listAlwaysIncludeIds(): Promise<string[]>;
  listAlwaysIncludeSkills(): Promise<PierHomeAlwaysIncludeSkill[]>;
  readSkillMd(skillId: string): Promise<string>;
  setAlwaysInclude(
    skillId: string,
    alwaysInclude: boolean,
    delivery?: PierHomeSkillDelivery
  ): Promise<PierHomeSkillView>;
  writeSkillMd(skillId: string, skillMd: string): Promise<PierHomeSkillView>;
}

function normalizeDelivery(
  value: PierHomeSkillDelivery | undefined
): PierHomeSkillDelivery {
  if (!value) return { ...DEFAULT_ALWAYS_INCLUDE_DELIVERY };
  const agents = value.agents === true;
  const claude = value.claude === true;
  if (!(agents || claude)) return { ...DEFAULT_ALWAYS_INCLUDE_DELIVERY };
  return { agents, claude };
}

function parseCatalogDelivery(raw: unknown): PierHomeSkillDelivery | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  return {
    agents: record.agents === true,
    claude: record.claude === true,
  };
}

export function createPierHomeSkillsLibrary(options: {
  homeRoot: string;
  now?: () => number;
}): PierHomeSkillsLibrary {
  const now = options.now ?? (() => Date.now());
  const skillsRoot = join(options.homeRoot, "skills");
  const libraryRoot = join(skillsRoot, LIBRARY_DIR);
  const catalogPath = join(skillsRoot, CATALOG_NAME);

  function contentDir(skillId: string): string {
    return join(libraryRoot, skillId);
  }

  function assertSkillId(skillId: string): string {
    const parsed = skillIdSchema.safeParse(skillId);
    if (!parsed.success) {
      throw new PierHomeSkillsError(
        "invalid-skill-id",
        `invalid skill id: ${skillId}`
      );
    }
    if (parsed.data.startsWith(PIER_SYSTEM_SKILL_PREFIX)) {
      throw new PierHomeSkillsError(
        "reserved-prefix",
        `skill id must not use the reserved ${PIER_SYSTEM_SKILL_PREFIX} prefix`
      );
    }
    return parsed.data;
  }

  async function readCatalog(): Promise<CatalogFile> {
    try {
      const raw = JSON.parse(
        await readFile(catalogPath, "utf8")
      ) as CatalogFile;
      if (raw.schemaVersion === 1 && Array.isArray(raw.skills)) {
        return {
          schemaVersion: 1,
          skills: raw.skills
            .filter(
              (entry) =>
                typeof entry?.id === "string" &&
                typeof entry.createdAt === "number" &&
                typeof entry.updatedAt === "number"
            )
            .map((entry) => {
              const delivery = parseCatalogDelivery(entry.delivery);
              return {
                id: entry.id,
                alwaysInclude: entry.alwaysInclude === true,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                ...(delivery === undefined ? {} : { delivery }),
              };
            }),
        };
      }
    } catch {
      // Missing/corrupt → empty catalog.
    }
    return { schemaVersion: 1, skills: [] };
  }

  async function writeCatalog(catalog: CatalogFile): Promise<void> {
    await mkdir(skillsRoot, { recursive: true });
    await writeFileAtomic(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  async function toView(entry: CatalogEntry): Promise<PierHomeSkillView> {
    const dir = contentDir(entry.id);
    const meta = await peekSkillMetadata(dir);
    const alwaysInclude = entry.alwaysInclude === true;
    return {
      id: entry.id,
      name: meta.name || entry.id,
      description: meta.description,
      alwaysInclude,
      delivery: alwaysInclude ? normalizeDelivery(entry.delivery) : null,
      absolutePath: join(dir, "SKILL.md"),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      // Library skills are not projected; agent effects belong on project rows.
      effects: [],
    };
  }

  async function requireEntry(skillId: string): Promise<{
    catalog: CatalogFile;
    entry: CatalogEntry;
  }> {
    const id = assertSkillId(skillId);
    const catalog = await readCatalog();
    const entry = catalog.skills.find((item) => item.id === id);
    if (!entry) {
      throw new PierHomeSkillsError("skill-missing", `skill not found: ${id}`);
    }
    return { catalog, entry };
  }

  const api: PierHomeSkillsLibrary = {
    contentDir,

    async ensureLayout(): Promise<void> {
      await mkdir(libraryRoot, { recursive: true });
      await writeCatalog(await readCatalog());
    },

    async list(): Promise<PierHomeSkillView[]> {
      await api.ensureLayout();
      const catalog = await readCatalog();
      const views: PierHomeSkillView[] = [];
      for (const entry of catalog.skills) {
        views.push(await toView(entry));
      }
      return views.sort((a, b) => a.id.localeCompare(b.id));
    },

    async listAlwaysIncludeIds(): Promise<string[]> {
      return (await api.listAlwaysIncludeSkills()).map((skill) => skill.id);
    },

    async listAlwaysIncludeSkills(): Promise<PierHomeAlwaysIncludeSkill[]> {
      const catalog = await readCatalog();
      return catalog.skills
        .filter((entry) => entry.alwaysInclude)
        .map((entry) => ({
          id: entry.id,
          delivery: normalizeDelivery(entry.delivery),
        }));
    },

    async create(args): Promise<PierHomeSkillView> {
      const skillId = assertSkillId(args.skillId);
      await api.ensureLayout();
      const catalog = await readCatalog();
      if (catalog.skills.some((entry) => entry.id === skillId)) {
        throw new PierHomeSkillsError(
          "skill-exists",
          `skill already exists: ${skillId}`
        );
      }
      await mkdir(contentDir(skillId), { recursive: true });
      const description = (args.description ?? "Pier library skill")
        .replace(/\r?\n/g, " ")
        .trim();
      const template = `---\nname: ${JSON.stringify(skillId)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${skillId}\n\n<!-- Describe when and how agents should use this skill. -->\n`;
      await writeFile(join(contentDir(skillId), "SKILL.md"), template, {
        mode: 0o644,
        flag: "wx",
      });
      const ts = now();
      const alwaysInclude = args.alwaysInclude === true;
      const entry: CatalogEntry = {
        id: skillId,
        alwaysInclude,
        createdAt: ts,
        updatedAt: ts,
        ...(alwaysInclude
          ? { delivery: normalizeDelivery(args.delivery) }
          : {}),
      };
      catalog.skills.push(entry);
      await writeCatalog(catalog);
      return toView(entry);
    },

    async readSkillMd(skillId: string): Promise<string> {
      const { entry } = await requireEntry(skillId);
      const raw = await readFile(
        join(contentDir(entry.id), "SKILL.md"),
        "utf8"
      );
      if (
        Buffer.byteLength(raw, "utf8") >
        SKILL_FRONTMATTER_LIMITS.maxSkillMdBytes
      ) {
        throw new PierHomeSkillsError(
          "skill-md-too-large",
          "SKILL.md exceeds the size limit"
        );
      }
      return raw;
    },

    async writeSkillMd(
      skillId: string,
      skillMd: string
    ): Promise<PierHomeSkillView> {
      if (
        Buffer.byteLength(skillMd, "utf8") >
        SKILL_FRONTMATTER_LIMITS.maxSkillMdBytes
      ) {
        throw new PierHomeSkillsError(
          "skill-md-too-large",
          "SKILL.md exceeds the size limit"
        );
      }
      let frontmatter: Record<string, unknown>;
      try {
        ({ frontmatter } = parseSafeSkillFrontmatter(skillMd));
      } catch (error) {
        throw new PierHomeSkillsError(
          "skill-md-invalid",
          error instanceof Error ? error.message : String(error),
          { cause: error }
        );
      }
      const { catalog, entry } = await requireEntry(skillId);
      if (frontmatter.name !== entry.id) {
        throw new PierHomeSkillsError(
          "skill-md-invalid",
          `SKILL.md name must match directory id "${entry.id}"`
        );
      }
      if (typeof frontmatter.description !== "string") {
        throw new PierHomeSkillsError(
          "skill-md-invalid",
          "SKILL.md frontmatter must include string description"
        );
      }
      await writeFileAtomic(join(contentDir(entry.id), "SKILL.md"), skillMd);
      entry.updatedAt = now();
      await writeCatalog(catalog);
      return toView(entry);
    },

    async setAlwaysInclude(
      skillId: string,
      alwaysInclude: boolean,
      delivery?: PierHomeSkillDelivery
    ): Promise<PierHomeSkillView> {
      const { catalog, entry } = await requireEntry(skillId);
      entry.alwaysInclude = alwaysInclude;
      if (alwaysInclude) {
        entry.delivery = normalizeDelivery(delivery);
      } else {
        entry.delivery = undefined;
      }
      entry.updatedAt = now();
      await writeCatalog(catalog);
      return toView(entry);
    },

    async delete(skillId: string): Promise<void> {
      const id = assertSkillId(skillId);
      const catalog = await readCatalog();
      const next = catalog.skills.filter((entry) => entry.id !== id);
      if (next.length === catalog.skills.length) {
        throw new PierHomeSkillsError(
          "skill-missing",
          `skill not found: ${id}`
        );
      }
      await writeCatalog({ schemaVersion: 1, skills: next });
      await rm(contentDir(id), { force: true, recursive: true });
    },
  };

  return api;
}
