import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitCommandSchemas } from "@shared/contracts/git/commands.ts";
import { describe, expect, it } from "vitest";

/**
 * git 命令表完整性治理：gitCommandSchemas 是唯一来源，handler / 授权 /
 * preload 暴露面必须与其双向一致，防止新增命令缺接线或删除命令留死面。
 * handler/permission 表非导出，按 diff-governance 先例以源码文本扫描。
 */
const ROOT = process.cwd();

const HANDLER_FILES = [
  join(ROOT, "src/main/app-core/commands/git.ts"),
  join(ROOT, "src/main/app-core/commands/git-review.ts"),
];
const PERMISSIONS_FILE = join(ROOT, "src/main/app-core/permissions.ts");
const PRELOAD_FILES = [
  join(ROOT, "src/preload/git-api.ts"),
  join(ROOT, "src/preload/git-review-api.ts"),
];

/** 文档化保留面：main 有 handler 与授权，但刻意不暴露 preload（服务 CLI/未来表面）。 */
const DELIBERATELY_UNEXPOSED = new Set([
  "git.createBranch",
  "git.deleteBranch",
]);

const HANDLER_CASE_RE = /(?:case|===)\s+"(git\.[^"]+)"/gu;
const PERMISSION_KEY_RE = /"(git\.[^"]+)":\s*\{/gu;
const PRELOAD_TYPE_RE = /type:\s*"(git\.[^"]+)"/gu;

function commandTypes(): string[] {
  return gitCommandSchemas.map((schema) => {
    const shape = schema.shape as { type?: { value?: string } };
    const type = shape.type?.value;
    if (type === undefined) {
      throw new Error("git command schema 缺少 type literal");
    }
    return type;
  });
}

function collectMatches(source: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const type = match[1];
    if (type !== undefined) {
      found.add(type);
    }
  }
  return found;
}

async function readSource(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("git command table completeness", () => {
  it("每个 schema 都有 handler case", async () => {
    const sources = await Promise.all(HANDLER_FILES.map(readSource));
    for (const type of commandTypes()) {
      expect(
        sources.some(
          (source) =>
            source.includes(`case "${type}"`) ||
            source.includes(`=== "${type}"`)
        ),
        `git command ${type} 缺少 dispatch case`
      ).toBe(true);
    }
  });

  it("每个 schema 都有权限条目", async () => {
    const permissions = await readSource(PERMISSIONS_FILE);
    for (const type of commandTypes()) {
      expect(
        permissions.includes(`"${type}": {`),
        `git command ${type} 缺少权限条目`
      ).toBe(true);
    }
  });

  it("每个 schema 都经 preload 暴露或文档化保留", async () => {
    const sources = await Promise.all(PRELOAD_FILES.map(readSource));
    for (const type of commandTypes()) {
      const exposed = sources.some((source) =>
        source.includes(`type: "${type}"`)
      );
      expect(
        exposed || DELIBERATELY_UNEXPOSED.has(type),
        `git command ${type} 既未暴露也未登记为保留面`
      ).toBe(true);
      if (exposed) {
        expect(
          DELIBERATELY_UNEXPOSED.has(type),
          `git command ${type} 已暴露但仍在保留面清单中`
        ).toBe(false);
      }
    }
  });

  it("保留面清单与注释声明一致", async () => {
    const preloadPath = PRELOAD_FILES[0];
    expect(preloadPath).toBeDefined();
    const preload = await readSource(preloadPath as string);
    for (const retained of [...DELIBERATELY_UNEXPOSED]) {
      expect(
        preload.includes(retained),
        `保留面 ${retained} 应在 preload 注释中声明`
      ).toBe(true);
    }
  });

  it("handler / 权限 / preload 不得残留 schema 外的 git 命令死面", async () => {
    const schemaTypes = new Set(commandTypes());
    const [handlerSources, permissions, preloadSources] = await Promise.all([
      Promise.all(HANDLER_FILES.map(readSource)),
      readSource(PERMISSIONS_FILE),
      Promise.all(PRELOAD_FILES.map(readSource)),
    ]);

    const handlerTypes = new Set<string>();
    for (const source of handlerSources) {
      for (const type of collectMatches(source, HANDLER_CASE_RE)) {
        handlerTypes.add(type);
      }
    }
    const permissionTypes = collectMatches(permissions, PERMISSION_KEY_RE);
    const preloadTypes = new Set<string>();
    for (const source of preloadSources) {
      for (const type of collectMatches(source, PRELOAD_TYPE_RE)) {
        preloadTypes.add(type);
      }
    }

    for (const type of handlerTypes) {
      expect(schemaTypes.has(type), `handler 残留 schema 外命令 ${type}`).toBe(
        true
      );
    }
    for (const type of permissionTypes) {
      expect(
        schemaTypes.has(type),
        `permissions 残留 schema 外命令 ${type}`
      ).toBe(true);
    }
    for (const type of preloadTypes) {
      expect(schemaTypes.has(type), `preload 残留 schema 外命令 ${type}`).toBe(
        true
      );
    }
  });
});
