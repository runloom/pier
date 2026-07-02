# Worktree 创建交互 P1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 worktree 创建从两个 `window.prompt()` 换成「单输入 + 实时推导预览」面板，创建后立即开终端并流式跑 setup（spec P1，见 [2026-07-02-worktree-creation-design.md](../specs/2026-07-02-worktree-creation-design.md)）。

**Architecture:** 命名推导是 `src/shared/` 纯函数；copy-files 是 main 进程新服务，挂在 command-router 的 `worktree.create` 之后；创建面板是 renderer 核心 overlay（仿 app-dialog-host：Zustand store + host 组件挂 app-shell），git 插件与「+」下拉通过 store API 打开；创建后复用已有 `terminal.open` Pier command（它已会解析 cwd→PanelContext、注册 launch、开终端面板）。

**Tech Stack:** Electron main/preload/renderer 三端 · zod 契约 · Zustand 5 · shadcn(@pier/ui) · Vitest（unit + component）。

## Global Constraints

- 遵守 AGENTS.md：不 `git add .`；commit 前 stage 明确路径并等待用户确认（执行会话开始时向用户一次性确认「按本计划逐任务 commit」即可）。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。TS 为 strict（含索引访问返回 `| undefined`，用 `??` 兜底）。
- 每个任务收尾跑 `pnpm lint:fix` 后再 `pnpm typecheck`（Biome/Ultracite 会要求对象键排序等，lint:fix 兜底）。
- 依赖边界（depcruise 守护）：`main/` ⊥ `renderer/`；plugin renderer 代码不 import renderer 内部 store —— 插件必须走 `RendererPluginContext` 桥接（Task 7 专门为此扩桥）。
- i18n：renderer 文案进 `src/renderer/i18n/locales/{en,zh-CN}/`，en 与 zh-CN 必须同步加。
- 分支名默认前缀 `wt/`；copy patterns 默认 `[".env*", "*.local", ".claude/settings.local.json"]`；setup 命令默认空字符串。
- **对 spec 的一处已知偏差**：spec 帧 2 的「base 默认 origin/HEAD + 后台 fetch」在 P1 降级为「默认当前 HEAD，下拉可选任意本地/远端分支」——仓库目前没有 fetch IPC（git-status-bar spec 已声明其为独立决策），P2 引入 fetch 后再切默认值。

---

### Task 1: 命名推导纯函数 `worktree-naming`

**Files:**
- Create: `src/shared/worktree-naming.ts`
- Test: `tests/unit/worktree-naming.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，零依赖）
- Produces:
  ```ts
  export type WorktreeNameSource = "branch" | "codename" | "description" | "existing-branch";
  export interface WorktreeCreationDraft { branch: string; name: string; source: WorktreeNameSource; }
  export interface DeriveWorktreeCreationArgs {
    branchPrefix: string;
    existingBranches: readonly string[];
    existingNames: readonly string[];
    input: string;
    random?: () => number;
  }
  export function deriveWorktreeCreation(args: DeriveWorktreeCreationArgs): WorktreeCreationDraft;
  export function sanitizeWorktreeName(value: string): string;
  export function slugifyDescription(input: string): string | null;
  ```
  Task 5 的 store 消费 `deriveWorktreeCreation`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/worktree-naming.test.ts
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
  slugifyDescription,
} from "@shared/worktree-naming.ts";
import { describe, expect, it } from "vitest";

const BASE_ARGS = {
  branchPrefix: "wt/",
  existingBranches: [] as readonly string[],
  existingNames: [] as readonly string[],
};

describe("slugifyDescription", () => {
  it("英文描述 → 小写连字符 slug,去停用词,截断到 24 字符", () => {
    expect(slugifyDescription("Fix the terminal focus bug")).toBe(
      "fix-terminal-focus-bug"
    );
    expect(
      slugifyDescription("implement a comprehensive workspace layout manager")
    ).toBe("implement-comprehensive");
  });

  it("CJK 描述提取 ascii token;纯 CJK 返回 null", () => {
    expect(slugifyDescription("修复 terminal focus 丢失")).toBe(
      "terminal-focus"
    );
    expect(slugifyDescription("修复终端焦点丢失")).toBeNull();
  });
});

describe("sanitizeWorktreeName", () => {
  it("斜杠转连字符,剔除非法字符,不产生 . / ..", () => {
    expect(sanitizeWorktreeName("feat/panel drag")).toBe("feat-panel-drag");
    expect(sanitizeWorktreeName("../x")).toBe("x");
  });
});

describe("deriveWorktreeCreation", () => {
  it("任务描述 → wt/ 前缀 slug 分支,name 与分支后缀一致", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "Fix the terminal focus bug",
    });
    expect(draft).toEqual({
      branch: "wt/fix-terminal-focus-bug",
      name: "fix-terminal-focus-bug",
      source: "description",
    });
  });

  it("分支名形态输入原样作为分支,不加前缀", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "feat/panel-drag",
    });
    expect(draft).toEqual({
      branch: "feat/panel-drag",
      name: "feat-panel-drag",
      source: "branch",
    });
  });

  it("命中已有分支 → source 为 existing-branch", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      existingBranches: ["feat/panel-drag"],
      input: "feat/panel-drag",
    });
    expect(draft.source).toBe("existing-branch");
    expect(draft.branch).toBe("feat/panel-drag");
  });

  it("与已有分支/worktree 重名时追加 -2", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      existingBranches: ["wt/fix-focus"],
      existingNames: ["fix-focus"],
      input: "fix focus",
    });
    expect(draft.branch).toBe("wt/fix-focus-2");
    expect(draft.name).toBe("fix-focus-2");
  });

  it("空输入 → 确定性 random 下产出 codename", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "",
      random: () => 0,
    });
    expect(draft.source).toBe("codename");
    expect(draft.branch.startsWith("wt/")).toBe(true);
    expect(draft.name.length).toBeGreaterThan(0);
  });

  it("纯 CJK 描述 → codename 兜底", () => {
    const draft = deriveWorktreeCreation({
      ...BASE_ARGS,
      input: "修复终端焦点丢失",
      random: () => 0.5,
    });
    expect(draft.source).toBe("codename");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/worktree-naming.test.ts`
Expected: FAIL — `Cannot find module '@shared/worktree-naming.ts'`

- [ ] **Step 3: 实现**

```ts
// src/shared/worktree-naming.ts
const BRANCH_LIKE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const SLUG_TOKEN_PATTERN = /[a-z0-9]+/g;
const MAX_SLUG_LENGTH = 24;

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "for", "in", "my", "of", "on",
  "or", "our", "please", "that", "the", "this", "to", "with",
]);

const CODENAME_ADJECTIVES = [
  "amber", "brisk", "calm", "clever", "coral", "eager",
  "gentle", "keen", "lucid", "mellow", "nimble", "quiet",
  "sunny", "swift", "tidal", "vivid",
] as const;

const CODENAME_NOUNS = [
  "anchor", "beacon", "breeze", "buoy", "cove", "current",
  "harbor", "jetty", "keel", "lagoon", "marina", "mast",
  "pier", "quay", "sail", "tide",
] as const;

export type WorktreeNameSource =
  | "branch"
  | "codename"
  | "description"
  | "existing-branch";

export interface WorktreeCreationDraft {
  branch: string;
  name: string;
  source: WorktreeNameSource;
}

export interface DeriveWorktreeCreationArgs {
  branchPrefix: string;
  existingBranches: readonly string[];
  existingNames: readonly string[];
  input: string;
  random?: () => number;
}

export function sanitizeWorktreeName(value: string): string {
  return value
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
}

export function slugifyDescription(input: string): string | null {
  const tokens = (input.toLowerCase().match(SLUG_TOKEN_PATTERN) ?? []).filter(
    (token) => !STOP_WORDS.has(token)
  );
  const first = tokens[0];
  if (!first) {
    return null;
  }
  let slug = "";
  for (const token of tokens) {
    const next = slug ? `${slug}-${token}` : token;
    if (next.length > MAX_SLUG_LENGTH) {
      break;
    }
    slug = next;
  }
  return slug || first.slice(0, MAX_SLUG_LENGTH);
}

function pickWord(words: readonly string[], random: () => number): string {
  const index = Math.min(words.length - 1, Math.floor(random() * words.length));
  return words[index] ?? "pier";
}

function codename(random: () => number): string {
  return `${pickWord(CODENAME_ADJECTIVES, random)}-${pickWord(CODENAME_NOUNS, random)}`;
}

function dedupe(base: string, taken: (candidate: string) => boolean): string {
  if (!taken(base)) {
    return base;
  }
  let suffix = 2;
  while (taken(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function draftFrom(
  branchBase: string,
  source: WorktreeNameSource,
  args: DeriveWorktreeCreationArgs
): WorktreeCreationDraft {
  const branchSet = new Set(args.existingBranches);
  const nameSet = new Set(args.existingNames);
  const branch =
    source === "existing-branch"
      ? branchBase
      : dedupe(branchBase, (candidate) => branchSet.has(candidate));
  const nameBase = sanitizeWorktreeName(branch) || "worktree";
  const prefixName = sanitizeWorktreeName(args.branchPrefix);
  const stripped =
    prefixName && nameBase.startsWith(`${prefixName}-`)
      ? nameBase.slice(prefixName.length + 1)
      : nameBase;
  const name = dedupe(stripped || "worktree", (candidate) =>
    nameSet.has(candidate)
  );
  return { branch, name, source };
}

export function deriveWorktreeCreation(
  args: DeriveWorktreeCreationArgs
): WorktreeCreationDraft {
  const input = args.input.trim();
  const random = args.random ?? Math.random;

  if (input.length === 0) {
    return draftFrom(`${args.branchPrefix}${codename(random)}`, "codename", args);
  }
  if (args.existingBranches.includes(input)) {
    return draftFrom(input, "existing-branch", args);
  }
  if (BRANCH_LIKE_PATTERN.test(input)) {
    return draftFrom(input, "branch", args);
  }
  const slug = slugifyDescription(input);
  if (!slug) {
    return draftFrom(`${args.branchPrefix}${codename(random)}`, "codename", args);
  }
  return draftFrom(`${args.branchPrefix}${slug}`, "description", args);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/worktree-naming.test.ts`
Expected: PASS（8 tests）。若 `修复 terminal focus 丢失` 断言失败，检查 token 过滤是否把 `focus`/`terminal` 保留、停用词只删列表内词。

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint:fix && pnpm typecheck
git add src/shared/worktree-naming.ts tests/unit/worktree-naming.test.ts
git commit -m "feat(worktree): naming derivation pure functions"
```

---

### Task 2: preferences 三个新键

**Files:**
- Modify: `src/shared/contracts/preferences.ts`（`projectPreferencesSchema`，行 64-106 附近）
- Modify: `src/main/services/preferences-service.ts`（`stripUndefinedPatch`）
- Test: `tests/unit/preferences-schema.test.ts`（追加）

**Interfaces:**
- Consumes: 无
- Produces: `ProjectPreferences` 新增字段（Task 3/5 消费）：
  ```ts
  worktreeBranchPrefix: string;        // default "wt/"
  worktreeCopyPatterns: string[];      // default [".env*", "*.local", ".claude/settings.local.json"]
  worktreeSetupCommand: string;        // default ""
  ```
  `ProjectPreferencesPatch` 由 `projectPreferencesSchema.partial()` 自动扩展；`PreferenceChangedKey = keyof ProjectPreferences` 自动扩展，均无需另改。

- [ ] **Step 1: 写失败测试（追加到 `tests/unit/preferences-schema.test.ts` 末尾）**

```ts
describe("worktree preferences", () => {
  it("空对象解析出 worktree 默认值", () => {
    const prefs = projectPreferencesSchema.parse({});
    expect(prefs.worktreeBranchPrefix).toBe("wt/");
    expect(prefs.worktreeCopyPatterns).toEqual([
      ".env*",
      "*.local",
      ".claude/settings.local.json",
    ]);
    expect(prefs.worktreeSetupCommand).toBe("");
  });

  it("可覆盖 worktree 键", () => {
    const prefs = projectPreferencesSchema.parse({
      worktreeBranchPrefix: "feature/",
      worktreeCopyPatterns: [".env"],
      worktreeSetupCommand: "pnpm setup:worktree",
    });
    expect(prefs.worktreeBranchPrefix).toBe("feature/");
    expect(prefs.worktreeCopyPatterns).toEqual([".env"]);
    expect(prefs.worktreeSetupCommand).toBe("pnpm setup:worktree");
  });
});
```

注意：该文件已有 `projectPreferencesSchema` 的 import 则复用；没有则按文件现有 import 风格补 `import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/preferences-schema.test.ts`
Expected: FAIL — `worktreeBranchPrefix` 为 `undefined`

- [ ] **Step 3: 实现**

`src/shared/contracts/preferences.ts` 的 `projectPreferencesSchema` 对象末尾（`agentCommandOverrides` 之后）追加：

```ts
  worktreeBranchPrefix: z.string().max(64).default("wt/"),
  worktreeCopyPatterns: z
    .array(z.string().min(1).max(256))
    .max(64)
    .default([".env*", "*.local", ".claude/settings.local.json"]),
  worktreeSetupCommand: z.string().max(1024).default(""),
```

`src/main/services/preferences-service.ts` 的 `stripUndefinedPatch` 返回对象中追加（保持字母序放到相应位置）：

```ts
    ...(patch.worktreeBranchPrefix !== undefined && {
      worktreeBranchPrefix: patch.worktreeBranchPrefix,
    }),
    ...(patch.worktreeCopyPatterns !== undefined && {
      worktreeCopyPatterns: patch.worktreeCopyPatterns,
    }),
    ...(patch.worktreeSetupCommand !== undefined && {
      worktreeSetupCommand: patch.worktreeSetupCommand,
    }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/preferences-schema.test.ts tests/unit/main/preferences-state.test.ts tests/unit/main/preferences-broadcast.test.ts`
Expected: 全 PASS（后两个是防回归——preferences 持久化/广播不受新键影响）

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint:fix && pnpm typecheck
git add src/shared/contracts/preferences.ts src/main/services/preferences-service.ts tests/unit/preferences-schema.test.ts
git commit -m "feat(worktree): branch prefix / copy patterns / setup command preferences"
```

---

### Task 3: copy-files 服务 + 挂接 `worktree.create`

**Files:**
- Create: `src/main/services/worktree-bootstrap.ts`
- Modify: `src/shared/contracts/worktree.ts`（`worktreeCreateResultSchema`）
- Modify: `src/main/app-core/command-router.ts`（`worktree.create` case，行 135-136 附近）
- Test: `tests/unit/main/worktree-bootstrap.test.ts`

**Interfaces:**
- Consumes: `ProjectPreferences.worktreeCopyPatterns`（Task 2）；`execGit`（`src/main/services/git-exec.ts`，签名同 worktree-service 的注入方式）
- Produces:
  ```ts
  export interface CopyWorktreeIncludesArgs {
    execGit?: (args: readonly string[], cwd: string, options?: { timeoutMs?: number }) => Promise<string>;
    mainPath: string;
    patterns: readonly string[];
    targetPath: string;
  }
  export interface CopyWorktreeIncludesResult { copied: string[]; skipped: string[]; }
  export function copyWorktreeIncludes(args: CopyWorktreeIncludesArgs): Promise<CopyWorktreeIncludesResult>;
  export function matchesCopyPattern(relPath: string, pattern: string): boolean;
  ```
  `WorktreeCreateResult` 新增可选字段 `copiedFiles?: string[]`（Task 5 toast 消费）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/worktree-bootstrap.test.ts
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  copyWorktreeIncludes,
  matchesCopyPattern,
} from "@main/services/worktree-bootstrap.ts";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function initRepoWithIgnoredFiles(): Promise<string> {
  const repo = await makeTempDir("pier-bootstrap-repo-");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(
    join(repo, ".gitignore"),
    ".env*\n*.local\nnode_modules/\n.claude/settings.local.json\n"
  );
  await git(repo, ["add", ".gitignore"]);
  await git(repo, ["commit", "-m", "init"]);
  await writeFile(join(repo, ".env"), "SECRET=1\n");
  await writeFile(join(repo, ".env.development"), "DEV=1\n");
  await writeFile(join(repo, "settings.local"), "x\n");
  await mkdir(join(repo, ".claude"), { recursive: true });
  await writeFile(join(repo, ".claude", "settings.local.json"), "{}\n");
  await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(repo, "node_modules", "pkg", "index.js"), "");
  return repo;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("matchesCopyPattern", () => {
  it("无 / 的 pattern 匹配 basename;带 / 的匹配相对路径", () => {
    expect(matchesCopyPattern(".env", ".env*")).toBe(true);
    expect(matchesCopyPattern("packages/app/.env.local", ".env*")).toBe(true);
    expect(matchesCopyPattern("a.local", "*.local")).toBe(true);
    expect(
      matchesCopyPattern(".claude/settings.local.json", ".claude/settings.local.json")
    ).toBe(true);
    expect(matchesCopyPattern("src/env.ts", ".env*")).toBe(false);
  });
});

describe("copyWorktreeIncludes", () => {
  it("复制命中 pattern 的 ignored 文件,跳过 node_modules", async () => {
    const repo = await initRepoWithIgnoredFiles();
    const target = join(repo, ".worktrees", "wt-a");
    await git(repo, ["worktree", "add", "-b", "wt/a", target]);

    const result = await copyWorktreeIncludes({
      mainPath: repo,
      patterns: [".env*", "*.local", ".claude/settings.local.json"],
      targetPath: target,
    });

    expect(result.copied.toSorted()).toEqual([
      ".claude/settings.local.json",
      ".env",
      ".env.development",
      "settings.local",
    ]);
    await access(join(target, ".env"));
    await access(join(target, ".claude", "settings.local.json"));
    await expect(access(join(target, "node_modules"))).rejects.toThrow();
  });

  it("patterns 为空时不做任何事", async () => {
    const repo = await initRepoWithIgnoredFiles();
    const target = join(repo, ".worktrees", "wt-b");
    await git(repo, ["worktree", "add", "-b", "wt/b", target]);
    const result = await copyWorktreeIncludes({
      mainPath: repo,
      patterns: [],
      targetPath: target,
    });
    expect(result).toEqual({ copied: [], skipped: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/main/worktree-bootstrap.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现服务**

```ts
// src/main/services/worktree-bootstrap.ts
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execGit } from "./git-exec.ts";

// 整目录被 gitignore 时 `--directory` 会折叠为单条目录项(如 node_modules/),
// 其内部文件不会枚举 —— 目录级复制不在 P1 范围。
const HARD_EXCLUDED_PREFIXES = [
  ".git/",
  ".worktrees/",
  "dist/",
  "node_modules/",
  "out/",
] as const;

export interface CopyWorktreeIncludesArgs {
  execGit?: (
    args: readonly string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>;
  mainPath: string;
  patterns: readonly string[];
  targetPath: string;
}

export interface CopyWorktreeIncludesResult {
  copied: string[];
  skipped: string[];
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export function matchesCopyPattern(relPath: string, pattern: string): boolean {
  const target = pattern.includes("/")
    ? relPath
    : (relPath.split("/").at(-1) ?? relPath);
  return globToRegExp(pattern).test(target);
}

export async function copyWorktreeIncludes({
  execGit: exec = defaultExecGit,
  mainPath,
  patterns,
  targetPath,
}: CopyWorktreeIncludesArgs): Promise<CopyWorktreeIncludesResult> {
  if (patterns.length === 0) {
    return { copied: [], skipped: [] };
  }
  const output = await exec(
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    mainPath,
    { timeoutMs: 30_000 }
  );
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith("/")) {
      continue;
    }
    if (HARD_EXCLUDED_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      continue;
    }
    if (!patterns.some((pattern) => matchesCopyPattern(entry, pattern))) {
      continue;
    }
    try {
      await mkdir(dirname(join(targetPath, entry)), { recursive: true });
      await copyFile(
        join(mainPath, entry),
        join(targetPath, entry),
        fsConstants.COPYFILE_EXCL
      );
      copied.push(entry);
    } catch (err) {
      console.warn(
        "[worktree-bootstrap] copy failed:",
        entry,
        err instanceof Error ? err.message : err
      );
      skipped.push(entry);
    }
  }
  return { copied, skipped };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/main/worktree-bootstrap.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 契约与 router 挂接**

`src/shared/contracts/worktree.ts` 的 `worktreeCreateResultSchema` 增加可选字段：

```ts
export const worktreeCreateResultSchema = z.object({
  copiedFiles: z.array(z.string()).optional(),
  created: worktreeItemSchema,
  targetPath: z.string().min(1),
  worktrees: z.array(worktreeItemSchema),
});
```

`src/main/app-core/command-router.ts`：顶部补 import：

```ts
import { copyWorktreeIncludes } from "../services/worktree-bootstrap.ts";
```

`executeWorktreeCommand` 中 `worktree.create` case 替换为：

```ts
    case "worktree.create": {
      const created = await services.worktrees.create(command);
      const copiedFiles = await copyCreateIncludes(created, services);
      return success(requestId, { ...created, copiedFiles });
    }
```

同文件新增 helper（放在 `executeWorktreeCommand` 之后）：

```ts
async function copyCreateIncludes(
  result: WorktreeCreateResult,
  services: PierCoreServices
): Promise<string[]> {
  const mainPath = result.worktrees.find((item) => item.isMain)?.path;
  if (!mainPath) {
    return [];
  }
  const preferences = await services.preferences.read();
  if (preferences.worktreeCopyPatterns.length === 0) {
    return [];
  }
  try {
    const copyResult = await copyWorktreeIncludes({
      mainPath,
      patterns: preferences.worktreeCopyPatterns,
      targetPath: result.targetPath,
    });
    return copyResult.copied;
  } catch (err) {
    // copy 失败不应让 create 整体失败:worktree 已建好,只是准备不完整。
    console.warn(
      "[command-router] worktree copy includes failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
```

`WorktreeCreateResult` 类型 import 按文件现有 `@shared/contracts/worktree.ts` import 组补上。

- [ ] **Step 6: 全量单测 + lint + typecheck + commit**

Run: `pnpm vitest run tests/unit && pnpm lint:fix && pnpm typecheck`
Expected: 全 PASS（重点看 worktree-service.test.ts 不回归）

```bash
git add src/main/services/worktree-bootstrap.ts src/shared/contracts/worktree.ts src/main/app-core/command-router.ts tests/unit/main/worktree-bootstrap.test.ts
git commit -m "feat(worktree): copy gitignored includes into new worktrees"
```

---

### Task 4: preload 暴露 `terminal.open`

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: 既有 `invokePierCommand`（`src/preload/index.ts:222`）与 `terminal.open` Pier command（schema 见 `src/shared/contracts/commands.ts:78-84`，实现 `src/main/app-core/panel-commands.ts:326`——已会 resolve cwd→PanelContext、注册 launch、通知 renderer 开终端面板）
- Produces: `window.pier.terminal.open(request)`：
  ```ts
  interface PierTerminalOpenRequest {
    focus?: boolean;
    launch?: TerminalLaunchOptions; // { agentId?, command?, cwd?, env?, profileId? }
  }
  open: (request: PierTerminalOpenRequest) => Promise<unknown>;
  ```
  Task 5 的 store 消费。

- [ ] **Step 1: 实现**

在 `src/preload/index.ts` 中找到现有 terminal API 对象（含 `openDebugWindow` 的那个接口与实现，grep `openDebugWindow`），接口声明加：

```ts
  open: (request: {
    focus?: boolean;
    launch?: TerminalLaunchOptions;
  }) => Promise<unknown>;
```

实现对象加：

```ts
  open: (request) =>
    invokePierCommand({
      type: "terminal.open",
      ...(request.focus !== undefined && { focus: request.focus }),
      ...(request.launch && { launch: request.launch }),
    }),
```

`TerminalLaunchOptions` 类型从 `@shared/contracts/terminal-launch.ts` import（type-only）。

- [ ] **Step 2: 验证**

Run: `pnpm typecheck && pnpm lint:fix`
Expected: PASS。（该方法为纯透传，行为由 Task 8 手动验收覆盖。）

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(terminal): expose terminal.open command to renderer"
```

---

### Task 5: 创建面板 store（打开/推导/提交流水线）

**Files:**
- Create: `src/renderer/stores/worktree-create.store.ts`
- Test: `tests/unit/renderer/stores/worktree-create-store.test.ts`

**Interfaces:**
- Consumes: `deriveWorktreeCreation`（Task 1）、`window.pier.worktrees.{list,create}`、`window.pier.git.listBranches`、`window.pier.preferences.read`、`window.pier.terminal.open`（Task 4）、`toast`（sonner）
- Produces（Task 6 UI 消费）:
  ```ts
  export interface WorktreeCreateSession {
    baseBranch: string | null;         // null = 当前 HEAD
    branch: string;
    branchEdited: boolean;
    branches: readonly GitBranchRef[];
    copyPatternCount: number;
    error: string | null;
    existingBranches: readonly string[];
    existingNames: readonly string[];
    input: string;
    mainPath: string;
    name: string;
    phase: "creating" | "idle";
    setupCommand: string;
    source: WorktreeNameSource;
  }
  export const useWorktreeCreateStore: /* zustand */ { session: WorktreeCreateSession | null };
  export async function openWorktreeCreatePanel(target: { path: string }): Promise<void>;
  export function updateWorktreeCreateInput(input: string): void;
  export function setWorktreeCreateBranch(branch: string): void;
  export function setWorktreeCreateBase(baseBranch: string | null): void;
  export function closeWorktreeCreatePanel(): void;
  export async function submitWorktreeCreate(options: { start: boolean }): Promise<void>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/renderer/stores/worktree-create-store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWorktreeCreatePanel,
  openWorktreeCreatePanel,
  submitWorktreeCreate,
  updateWorktreeCreateInput,
  useWorktreeCreateStore,
} from "@/stores/worktree-create.store.ts";

const listMock = vi.fn();
const createMock = vi.fn();
const listBranchesMock = vi.fn();
const preferencesReadMock = vi.fn();
const terminalOpenMock = vi.fn();

beforeEach(() => {
  listMock.mockResolvedValue({
    currentPath: "/repo",
    mainPath: "/repo",
    path: "/repo",
    status: "available",
    worktrees: [
      {
        bare: false, branch: "main", detached: false, head: "abc",
        isCurrent: true, isMain: true, locked: false, lockedReason: null,
        path: "/repo", prunable: false, prunableReason: null,
      },
    ],
  });
  createMock.mockResolvedValue({
    copiedFiles: [".env"],
    created: {
      bare: false, branch: "wt/fix-focus", detached: false, head: "def",
      isCurrent: false, isMain: false, locked: false, lockedReason: null,
      path: "/repo/.worktrees/fix-focus", prunable: false, prunableReason: null,
    },
    targetPath: "/repo/.worktrees/fix-focus",
    worktrees: [],
  });
  listBranchesMock.mockResolvedValue([
    { isCurrent: true, kind: "local", lastCommit: "abc", name: "main", upstream: null },
  ]);
  preferencesReadMock.mockResolvedValue({
    worktreeBranchPrefix: "wt/",
    worktreeCopyPatterns: [".env*"],
    worktreeSetupCommand: "pnpm setup:worktree",
  });
  terminalOpenMock.mockResolvedValue(null);
  Object.assign(window, {
    pier: {
      git: { listBranches: listBranchesMock },
      preferences: { read: preferencesReadMock },
      terminal: { open: terminalOpenMock },
      worktrees: { create: createMock, list: listMock },
    },
  });
});

afterEach(() => {
  closeWorktreeCreatePanel();
  vi.clearAllMocks();
});

describe("worktree-create.store", () => {
  it("打开面板后输入描述实时推导分支与目录名", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus bug");
    const session = useWorktreeCreateStore.getState().session;
    expect(session?.branch).toBe("wt/fix-focus-bug");
    expect(session?.name).toBe("fix-focus-bug");
    expect(session?.setupCommand).toBe("pnpm setup:worktree");
  });

  it("提交:create → terminal.open(cwd=targetPath, command=setup)", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: true });
    expect(createMock).toHaveBeenCalledWith({
      branch: "wt/fix-focus",
      name: "fix-focus",
      path: "/repo",
    });
    expect(terminalOpenMock).toHaveBeenCalledWith({
      focus: true,
      launch: {
        command: "pnpm setup:worktree",
        cwd: "/repo/.worktrees/fix-focus",
      },
    });
    expect(useWorktreeCreateStore.getState().session).toBeNull();
  });

  it("仅创建(start:false)不开终端", async () => {
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: false });
    expect(terminalOpenMock).not.toHaveBeenCalled();
  });

  it("create 失败时面板保留并显示错误", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    await openWorktreeCreatePanel({ path: "/repo" });
    updateWorktreeCreateInput("fix focus");
    await submitWorktreeCreate({ start: true });
    const session = useWorktreeCreateStore.getState().session;
    expect(session?.error).toContain("invalid worktree branch");
    expect(session?.phase).toBe("idle");
  });
});
```

注意：该测试目录已有同形态先例（`tests/unit/renderer/stores/agent-preferences-store.test.ts`），若其对 `window.pier` 有统一 setup helper，改用之。sonner 的 `toast` 在 vitest 环境可直接调用（无 DOM 渲染副作用）；若报错则在测试顶部 `vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/stores/worktree-create-store.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

```ts
// src/renderer/stores/worktree-create.store.ts
/**
 * worktree 创建面板状态。渲染由 components/common/worktree-create-host.tsx 承担。
 * 全局单例:重复 open 会顶替未决会话。
 */
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type { WorktreeNameSource } from "@shared/worktree-naming.ts";
import { deriveWorktreeCreation } from "@shared/worktree-naming.ts";
import { toast } from "sonner";
import { create } from "zustand";

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: string): string {
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

export interface WorktreeCreateSession {
  baseBranch: string | null;
  branch: string;
  branchEdited: boolean;
  branches: readonly GitBranchRef[];
  copyPatternCount: number;
  error: string | null;
  existingBranches: readonly string[];
  existingNames: readonly string[];
  input: string;
  mainPath: string;
  name: string;
  phase: "creating" | "idle";
  setupCommand: string;
  source: WorktreeNameSource;
}

interface WorktreeCreateState {
  session: WorktreeCreateSession | null;
}

export const useWorktreeCreateStore = create<WorktreeCreateState>(() => ({
  session: null,
}));

function patchSession(patch: Partial<WorktreeCreateSession>): void {
  const session = useWorktreeCreateStore.getState().session;
  if (!session) {
    return;
  }
  useWorktreeCreateStore.setState({ session: { ...session, ...patch } });
}

function deriveFor(
  session: Pick<
    WorktreeCreateSession,
    "existingBranches" | "existingNames" | "input"
  >,
  branchPrefix: string
): Pick<WorktreeCreateSession, "branch" | "name" | "source"> {
  const draft = deriveWorktreeCreation({
    branchPrefix,
    existingBranches: session.existingBranches,
    existingNames: session.existingNames,
    input: session.input,
  });
  return { branch: draft.branch, name: draft.name, source: draft.source };
}

let activeBranchPrefix = "wt/";

export async function openWorktreeCreatePanel(target: {
  path: string;
}): Promise<void> {
  const listResult = await window.pier.worktrees.list({ path: target.path });
  if (listResult.status !== "available") {
    toast.error(listResult.reason);
    return;
  }
  const [branches, preferences] = await Promise.all([
    window.pier.git.listBranches(listResult.mainPath, { kind: "all" }),
    window.pier.preferences.read(),
  ]);
  activeBranchPrefix = preferences.worktreeBranchPrefix;
  const existingBranches = branches.map((ref) => ref.name);
  const existingNames = listResult.worktrees.map((item) =>
    basename(item.path)
  );
  const base = {
    existingBranches,
    existingNames,
    input: "",
  };
  useWorktreeCreateStore.setState({
    session: {
      ...base,
      ...deriveFor(base, activeBranchPrefix),
      baseBranch: null,
      branchEdited: false,
      branches,
      copyPatternCount: preferences.worktreeCopyPatterns.length,
      error: null,
      mainPath: listResult.mainPath,
      phase: "idle",
      setupCommand: preferences.worktreeSetupCommand,
    },
  });
}

export function updateWorktreeCreateInput(input: string): void {
  const session = useWorktreeCreateStore.getState().session;
  if (!session) {
    return;
  }
  const next = { ...session, error: null, input };
  const derived = next.branchEdited
    ? {}
    : deriveFor(next, activeBranchPrefix);
  useWorktreeCreateStore.setState({ session: { ...next, ...derived } });
}

export function setWorktreeCreateBranch(branch: string): void {
  patchSession({ branch, branchEdited: true, error: null });
}

export function setWorktreeCreateBase(baseBranch: string | null): void {
  patchSession({ baseBranch, error: null });
}

export function closeWorktreeCreatePanel(): void {
  useWorktreeCreateStore.setState({ session: null });
}

export async function submitWorktreeCreate(options: {
  start: boolean;
}): Promise<void> {
  const session = useWorktreeCreateStore.getState().session;
  if (!session || session.phase === "creating") {
    return;
  }
  patchSession({ error: null, phase: "creating" });
  try {
    const result = await window.pier.worktrees.create({
      ...(session.baseBranch ? { base: session.baseBranch } : {}),
      branch: session.branch,
      name: session.name,
      path: session.mainPath,
    });
    closeWorktreeCreatePanel();
    toast.success(`${session.branch} · ${result.targetPath}`);
    if (options.start) {
      const setup = session.setupCommand.trim();
      await window.pier.terminal.open({
        focus: true,
        launch: {
          ...(setup ? { command: setup } : {}),
          cwd: result.targetPath,
        },
      });
    }
  } catch (err) {
    patchSession({
      error: err instanceof Error ? err.message : String(err),
      phase: "idle",
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/stores/worktree-create-store.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint:fix && pnpm typecheck
git add src/renderer/stores/worktree-create.store.ts tests/unit/renderer/stores/worktree-create-store.test.ts
git commit -m "feat(worktree): create panel store with derivation and submit pipeline"
```

---

### Task 6: 创建面板 UI + i18n + 挂载

**Files:**
- Create: `src/renderer/components/common/worktree-create-host.tsx`
- Create: `src/renderer/i18n/locales/en/worktree.ts`、`src/renderer/i18n/locales/zh-CN/worktree.ts`
- Modify: `src/renderer/i18n/locales/en/index.ts`、`src/renderer/i18n/locales/zh-CN/index.ts`（注册模块）
- Modify: `src/renderer/components/common/app-shell.tsx`（`<AppDialogHost />` 旁挂 `<WorktreeCreateHost />`）
- Test: `tests/component/worktree-create-host.test.tsx`

**Interfaces:**
- Consumes: Task 5 store 全部导出；`@pier/ui/{dialog,input,select,badge,kbd,button}.tsx`；overlay 屏蔽三件套（照抄 [app-dialog-host.tsx:26-39](../../../src/renderer/components/common/app-dialog-host.tsx)：`registerTerminalFullscreenWebOverlay` + `requestTerminalWebFocus` + `useKeybindingScope.pushBlockingScope`，overlay id 用 `"worktree-create"`）
- Produces: `WorktreeCreateHost` 组件（无 props，session 为 null 时返回 null）

- [ ] **Step 1: i18n 文案**

```ts
// src/renderer/i18n/locales/en/worktree.ts
export const worktree = {
  create: {
    autoBadge: "Auto",
    baseHead: "Current HEAD",
    baseLabel: "Base",
    branchLabel: "Branch",
    cancelHint: "Cancel",
    createAndStartHint: "Create and start",
    createOnlyHint: "Create only",
    creating: "Creating…",
    emptyHint: "Empty input creates an auto codename",
    inputPlaceholder: "Describe the task, or type a branch name",
    locationLabel: "Location",
    prepareCopy: "Copy {{count}} ignored file patterns",
    prepareLabel: "Prepare",
    prepareNone: "No prepare steps configured",
    prepareSetup: "Run setup command",
    title: "New worktree",
  },
} as const;
```

```ts
// src/renderer/i18n/locales/zh-CN/worktree.ts
export const worktree = {
  create: {
    autoBadge: "自动",
    baseHead: "当前 HEAD",
    baseLabel: "基于",
    branchLabel: "分支",
    cancelHint: "取消",
    createAndStartHint: "创建并开工",
    createOnlyHint: "仅创建",
    creating: "创建中…",
    emptyHint: "留空回车自动起名",
    inputPlaceholder: "描述任务,或直接输入分支名",
    locationLabel: "位置",
    prepareCopy: "复制 {{count}} 组 ignored 文件",
    prepareLabel: "准备",
    prepareNone: "未配置准备步骤",
    prepareSetup: "运行 setup 命令",
    title: "新建 worktree",
  },
} as const;
```

两个 `index.ts` 各自 import 并加入导出对象（对齐现有 `workspace` 的接法）。

- [ ] **Step 2: 写失败组件测试**

```tsx
// tests/component/worktree-create-host.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeCreateHost } from "@/components/common/worktree-create-host.tsx";
import {
  closeWorktreeCreatePanel,
  openWorktreeCreatePanel,
} from "@/stores/worktree-create.store.ts";

const createMock = vi.fn();

beforeEach(() => {
  createMock.mockResolvedValue({
    copiedFiles: [],
    created: {
      bare: false, branch: "wt/fix-focus", detached: false, head: "def",
      isCurrent: false, isMain: false, locked: false, lockedReason: null,
      path: "/repo/.worktrees/fix-focus", prunable: false, prunableReason: null,
    },
    targetPath: "/repo/.worktrees/fix-focus",
    worktrees: [],
  });
  Object.assign(window, {
    pier: {
      git: {
        listBranches: vi.fn().mockResolvedValue([
          { isCurrent: true, kind: "local", lastCommit: "abc", name: "main", upstream: null },
        ]),
      },
      preferences: {
        read: vi.fn().mockResolvedValue({
          worktreeBranchPrefix: "wt/",
          worktreeCopyPatterns: [".env*"],
          worktreeSetupCommand: "pnpm setup:worktree",
        }),
      },
      terminal: { open: vi.fn().mockResolvedValue(null) },
      worktrees: {
        create: createMock,
        list: vi.fn().mockResolvedValue({
          currentPath: "/repo",
          mainPath: "/repo",
          path: "/repo",
          status: "available",
          worktrees: [
            {
              bare: false, branch: "main", detached: false, head: "abc",
              isCurrent: true, isMain: true, locked: false, lockedReason: null,
              path: "/repo", prunable: false, prunableReason: null,
            },
          ],
        }),
      },
    },
  });
});

afterEach(() => {
  closeWorktreeCreatePanel();
  vi.clearAllMocks();
});

describe("WorktreeCreateHost", () => {
  it("输入描述后展示推导的分支与位置;Enter 提交 create", async () => {
    const user = userEvent.setup();
    render(<WorktreeCreateHost />);
    await openWorktreeCreatePanel({ path: "/repo" });

    const input = await screen.findByRole("textbox", { name: /worktree/i });
    await user.type(input, "fix focus bug");
    expect(await screen.findByText("wt/fix-focus-bug")).toBeInTheDocument();
    expect(screen.getByText(".worktrees/fix-focus-bug")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(createMock).toHaveBeenCalledWith({
      branch: "wt/fix-focus-bug",
      name: "fix-focus-bug",
      path: "/repo",
    });
  });
});
```

（渲染环境、testing-library 用法与 provider 包裹对齐 `tests/component/app-dialog-host.test.tsx` 现有写法；若组件测试需要 i18n provider，照它的 setup。）

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/component/worktree-create-host.test.tsx`
Expected: FAIL — 组件不存在

- [ ] **Step 4: 实现组件**

```tsx
// src/renderer/components/common/worktree-create-host.tsx
import { Badge } from "@pier/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { GitBranch } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";
import {
  closeWorktreeCreatePanel,
  setWorktreeCreateBase,
  setWorktreeCreateBranch,
  submitWorktreeCreate,
  updateWorktreeCreateInput,
  useWorktreeCreateStore,
} from "@/stores/worktree-create.store.ts";

const WORKTREE_CREATE_OVERLAY_ID = "worktree-create";
const HEAD_SENTINEL = "__head__";

export function WorktreeCreateHost() {
  const t = useT();
  const session = useWorktreeCreateStore((state) => state.session);

  useEffect(() => {
    if (!session) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay(
      WORKTREE_CREATE_OVERLAY_ID
    );
    const releaseWebFocus = requestTerminalWebFocus(
      WORKTREE_CREATE_OVERLAY_ID
    );
    const scopeId = `overlay:${WORKTREE_CREATE_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
    // session 存在性变化时挂/卸 overlay,与 app-dialog-host 一致
  }, [session !== null]);

  if (!session) {
    return null;
  }

  const creating = session.phase === "creating";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          closeWorktreeCreatePanel();
        }
      }}
      open
    >
      <DialogContent className="max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="size-4" />
            {t("worktree.create.title")}
          </DialogTitle>
        </DialogHeader>
        <Input
          aria-label={t("worktree.create.title")}
          autoFocus
          disabled={creating}
          onChange={(event) => updateWorktreeCreateInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            submitWorktreeCreate({ start: !event.shiftKey }).catch(
              () => undefined
            );
          }}
          placeholder={t("worktree.create.inputPlaceholder")}
          value={session.input}
        />
        <div className="grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.branchLabel")}
          </span>
          <span className="flex items-center gap-2">
            <Input
              className="h-6 flex-1 font-mono text-xs"
              disabled={creating}
              onChange={(event) => setWorktreeCreateBranch(event.target.value)}
              value={session.branch}
            />
            {session.source !== "branch" && !session.branchEdited ? (
              <Badge variant="secondary">{t("worktree.create.autoBadge")}</Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.locationLabel")}
          </span>
          <span className="font-mono text-muted-foreground text-xs">
            {`.worktrees/${session.name}`}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.baseLabel")}
          </span>
          <Select
            disabled={creating}
            onValueChange={(value) => {
              setWorktreeCreateBase(value === HEAD_SENTINEL ? null : value);
            }}
            value={session.baseBranch ?? HEAD_SENTINEL}
          >
            <SelectTrigger className="h-6 w-fit font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HEAD_SENTINEL}>
                {t("worktree.create.baseHead")}
              </SelectItem>
              {session.branches.map((ref) => (
                <SelectItem key={`${ref.kind}:${ref.name}`} value={ref.name}>
                  {ref.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.prepareLabel")}
          </span>
          <span className="flex flex-wrap gap-1">
            {session.copyPatternCount > 0 ? (
              <Badge variant="outline">
                {t("worktree.create.prepareCopy", {
                  count: session.copyPatternCount,
                })}
              </Badge>
            ) : null}
            {session.setupCommand.trim() ? (
              <Badge variant="outline">
                {t("worktree.create.prepareSetup")}
              </Badge>
            ) : null}
            {session.copyPatternCount === 0 && !session.setupCommand.trim() ? (
              <span className="text-muted-foreground text-xs">
                {t("worktree.create.prepareNone")}
              </span>
            ) : null}
          </span>
        </div>
        {session.error ? (
          <p className="text-destructive text-xs">{session.error}</p>
        ) : null}
        <div className="flex items-center gap-4 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Kbd>⏎</Kbd>
            {creating
              ? t("worktree.create.creating")
              : t("worktree.create.createAndStartHint")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧⏎</Kbd>
            {t("worktree.create.createOnlyHint")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            {t("worktree.create.cancelHint")}
          </span>
          <span className="ml-auto">{t("worktree.create.emptyHint")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

实现提示：`@pier/ui` 各组件的具体导出名以文件为准（如 `Badge` 的 variant 值、`Kbd` 的用法），跑 typecheck 时按报错修正；样式 className 允许微调，交互契约（Enter/Shift+Enter/Esc、行内容）不可变。

- [ ] **Step 5: 挂载**

`src/renderer/components/common/app-shell.tsx`：import 并在 `<AppDialogHost />` 后加 `<WorktreeCreateHost />`。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run tests/component/worktree-create-host.test.tsx && pnpm vitest run tests/component/app-dialog-host.test.tsx`
Expected: PASS（后者防回归）

- [ ] **Step 7: lint + typecheck + commit**

```bash
pnpm lint:fix && pnpm typecheck
git add src/renderer/components/common/worktree-create-host.tsx src/renderer/components/common/app-shell.tsx src/renderer/i18n/locales/en/worktree.ts src/renderer/i18n/locales/zh-CN/worktree.ts src/renderer/i18n/locales/en/index.ts src/renderer/i18n/locales/zh-CN/index.ts tests/component/worktree-create-host.test.tsx
git commit -m "feat(worktree): create panel UI with live derivation preview"
```

---

### Task 7: 两个入口接线（「+」下拉 + 命令面板）

**Files:**
- Modify: `src/renderer/components/workspace/add-panel-action.tsx`
- Modify: `src/plugins/api/renderer.ts`（`worktrees` 段，行 250-257）
- Modify: `src/renderer/lib/plugins/host-context.ts`（`worktrees` 段，行 367-373）
- Modify: `src/plugins/builtin/git/renderer/worktree-operation-actions.ts`（`registerWorktreeCreateAction`，行 145-210）
- Modify: `src/renderer/i18n/locales/{en,zh-CN}/workspace.ts`（菜单文案）

**Interfaces:**
- Consumes: `openWorktreeCreatePanel`（Task 5）、`usePanelDescriptorStore`（活动 panel context，取法照 [host-context.ts:344-349](../../../src/renderer/lib/plugins/host-context.ts)）
- Produces: `RendererPluginContext.worktrees.openCreatePanel(request: WorktreeOpenRequest): void`

- [ ] **Step 1: 插件 API 桥**

`src/plugins/api/renderer.ts` 的 `worktrees` 接口加一行（字母序落位）：

```ts
    openCreatePanel(request: WorktreeOpenRequest): void;
```

`src/renderer/lib/plugins/host-context.ts` 的 `worktrees` 实现对象加：

```ts
      openCreatePanel: (request) => {
        void openWorktreeCreatePanel({ path: request.path });
      },
```

并在文件顶部 import `openWorktreeCreatePanel`。

- [ ] **Step 2: git 插件 create action 换实现**

`worktree-operation-actions.ts` 的 `registerWorktreeCreateAction` handler 整体替换为：

```ts
    handler: () => {
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      context.worktrees.openCreatePanel({ path: target.path });
    },
```

删除 `promptText`（连同其 biome-ignore 注释）——确认文件内无其他调用后删除；`showWorktreeMessage`/`confirmQuickPick` 仍被 delete/prune 使用，保留。

- [ ] **Step 3:「+」下拉菜单项**

`add-panel-action.tsx`：`New Task` 项之后、分隔线之前插入（import `GitBranchPlus` from lucide、`usePanelDescriptorStore`、`openWorktreeCreatePanel`）：

```tsx
          <DropdownMenuItem
            onClick={() => {
              const state = usePanelDescriptorStore.getState();
              const context = state.activeId
                ? state.descriptors[state.activeId]?.context
                : undefined;
              const path =
                context?.worktreeRoot ??
                context?.gitRoot ??
                context?.projectRoot ??
                context?.cwd;
              if (path) {
                openWorktreeCreatePanel({ path }).catch(() => undefined);
              }
            }}
          >
            <GitBranchPlus className="size-4" />
            <span>{t("workspace.addPanelMenu.newWorktree")}</span>
          </DropdownMenuItem>
```

i18n：`locales/en/workspace.ts` 的 `addPanelMenu` 加 `newWorktree: "New Worktree"`；zh-CN 加 `newWorktree: "新建 Worktree"`。

- [ ] **Step 4: 验证**

Run: `pnpm lint:fix && pnpm typecheck && pnpm vitest run tests/component/workspace-header-actions.test.tsx tests/unit`
Expected: 全 PASS（workspace-header-actions 组件测试若因新菜单项断言 fail，按其现有断言风格补该项）。另跑 `pnpm check` 确认 depcruise 无违例（host-context/add-panel-action import renderer store 合法；git 插件未 import renderer 内部模块）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/workspace/add-panel-action.tsx src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts src/plugins/builtin/git/renderer/worktree-operation-actions.ts src/renderer/i18n/locales/en/workspace.ts src/renderer/i18n/locales/zh-CN/workspace.ts
git commit -m "feat(worktree): wire create panel into + menu and command palette"
```

---

### Task 8: 全量验证 + 手动验收

- [ ] **Step 1: 全量检查**

Run: `pnpm check && pnpm test:unit && pnpm test:component`
Expected: 全 PASS（`pnpm check` = typecheck + lint + depcruise + file-size）

- [ ] **Step 2: 手动验收（`pnpm dev`，在 Pier 主仓打开）**

按 spec 四帧逐条过：

1. 「+」下拉出现 New Worktree；命令面板 `Create Worktree` 打开同一面板（不再是 prompt）。
2. 输入 `修复 terminal focus 丢失` → 分支行显示 `wt/terminal-focus`、位置 `.worktrees/terminal-focus`；输入纯中文 → codename；输入 `feat/xyz` → 原样分支。
3. `⏎`：worktree 创建成功，终端面板打开、cwd 在新 worktree、可见 setup 命令输出（先在设置 JSON 里把 `worktreeSetupCommand` 设为 `pnpm setup:worktree`）；toast 出现。
4. `.env` 类文件出现在新 worktree（在主仓放一个测试用 `.env` 验证）。
5. `⇧⏎`：只创建不开终端。`esc`：关闭面板。
6. 错误路径：输入一个已被其他 worktree 检出的分支名提交 → 面板保留并显示 git 报错信息（完整冲突恢复动作是 P2）。

- [ ] **Step 3: 结果汇报**

把手动验收 6 条的实际结果逐条回报给用户，有偏差的列出来再修。

---

## P2 预告（本计划不做，另立计划）

agent chips + 任务描述作为首 prompt（需扩 `resolveTerminalLaunchBase` 支持 setup 与 agent 命令串联）、冲突恢复两动作（跳转/副本分支）、worktree 列表 quick-pick 首行入口、tab worktree 徽标、`worktreeLastLaunch` 记忆、fetch IPC + base 默认切 `origin/HEAD`。
