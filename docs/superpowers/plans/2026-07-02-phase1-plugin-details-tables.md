# Phase 1: 插件详情页表格化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把插件详情页（设置 → 插件 → 展开详情）的贡献点展示从 badge flex-wrap 瀑布重构为分区紧凑表格（命令表 / 面板表 / 终端状态项表，无贡献则整区隐藏）；元数据行补 homepage / repository 外链；命令新增可 i18n 的「分类」列；沉淀 Phase 3 复用的通用 `ContributionTable` 组件（硬接口 `{ headers: string[]; rows: ReactNode[][] }`，不可改）。

**Architecture:** 纯 renderer UI 改动 + shared Zod schema 的向后兼容扩展 + 内置 git 插件数据补齐。数据流不变：`plugins-section.tsx` 经 `window.pier.plugins.list()` 拿 `PluginRegistryEntry`，用 `src/renderer/lib/plugins/display.ts` 的 resolve 函数做 manifest i18n，注入 `PluginDetails` 展示。新增 `contribution-table.tsx` 复用 `@pier/ui/table.tsx` 原语（`packages/ui/src/table.tsx` 已存在，压缩密度用 className 覆盖）。外链沿用现有机制：renderer 里 `<a target="_blank">`，main 侧 `window-manager.ts:281` 的 `setWindowOpenHandler` → `shell.openExternal`（参照 `agent-row.tsx:217-228` 先例），无需新增 IPC。不触碰 main/preload/dockview，depcruise 边界零风险。

**Tech Stack:** React 19 · TypeScript 6 strict（`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` 均开启）· Zod（shared contracts）· Tailwind v4 + `@pier/ui` shadcn 原语 · i18next · Vitest 4。

## Global Constraints

- TS strict：禁止 `@ts-ignore`、`@ts-expect-error`、`as any`（AGENTS.md §05）。`exactOptionalPropertyTypes` 开启——可选字段一律用 `...(value ? { key: value } : {})` 展开模式（见 `display.ts:132` 现有写法）。
- Biome 2.5 + Ultracite lint 必须通过；每个 UI task 结束先跑 `pnpm lint:fix` 再 `pnpm lint`。`suspicious/noArrayIndexKey` 在 `src/renderer/pages/**` 处于开启状态（biome.json 仅对 `packages/ui/src/**` 等关闭）——本计划在 `contribution-table.tsx` 有一处**经论证的** `biome-ignore` 行级抑制（rows 是每次渲染重建的静态展示数据、行序即身份、硬接口无 id 可用），除此之外禁止新增任何 lint 抑制。
- depcruise 边界：本 Phase 只动 `src/renderer/`、`src/shared/`、`src/plugins/builtin/git/` 与 `tests/`；renderer 内不 import dockview、不跨 panel-kits；`src/plugins/**` 不得 import main/renderer（git 插件只改 manifest.ts 与纯 JSON locale 文件，天然合规）。
- Git 默认只读：全程不主动 commit。若用户要求 commit，必须先 stage **明确路径**（禁 `git add .`），展示 `git diff --staged` 与拟用 Conventional Commits message，等用户确认；禁 `git reset` / `git rebase` / `git commit --amend` / force-push。
- 每个 Task 结束必须跑 `pnpm check`（typecheck + lint + depcruise + file-size）并确认通过；含 schema/resolve 改动的 Task 额外跑 `pnpm test:unit`。
- 若当前 worktree 尚未初始化（`node_modules` 缺失），先跑 `pnpm setup:worktree`。

---

### Task 1: PluginLocaleMessages.commands 支持 category（shared schema + display resolve + 单测）

**Files:**

- Modify: `src/shared/contracts/plugin.ts`（在 line 23–30 的 `pluginLocalizedContributionSchema` 之后插入新 schema；改 line 32–35 `pluginLocaleMessagesSchema` 的 `commands` 字段）
- Modify: `src/renderer/lib/plugins/display.ts`（line 15–18 `PluginContributionDisplayText` 之后加新接口；重写 line 136–156 `resolvePluginCommandDisplay`）
- Test: Create `tests/unit/plugins/command-category.test.ts`

**Interfaces:**

- Consumes:
  - `pluginLocalizedContributionSchema`（`src/shared/contracts/plugin.ts:23`，`{ aliases?: string[]; description?: string; title?: string }`）
  - `resolveFromLocales(manifest: PluginManifest, locale: string, pick: (messages: PluginLocaleMessages) => string | undefined): string | undefined`（`display.ts:54`，模块私有，直接复用）
  - `PluginCommandContribution`（`plugin.ts:62`，已含 `category?: string`，line 56 `category: z.string().min(1).optional()`）
- Produces:
  - `pluginLocalizedCommandContributionSchema`（= `pluginLocalizedContributionSchema.extend({ category: z.string().min(1).optional() })`）与类型 `PluginLocalizedCommandContribution`
  - `PluginLocaleMessages["commands"]` 值类型变为 `PluginLocalizedCommandContribution`
  - `export interface PluginCommandDisplayText extends PluginContributionDisplayText { category?: string }`
  - `resolvePluginCommandDisplay(manifest: PluginManifest, command: PluginCommandContribution, locale: string): PluginCommandDisplayText`（返回类型收窄为新接口，签名参数不变，回落链：locale category ?? manifest `command.category`）

- [ ] **Step 1: 扩展 shared schema。** 在 `src/shared/contracts/plugin.ts` 中，于 `pluginLocalizedContributionSchema` 的类型导出（line 28–30）之后插入：

  ```ts
  export const pluginLocalizedCommandContributionSchema =
    pluginLocalizedContributionSchema.extend({
      category: z.string().min(1).optional(),
    });
  export type PluginLocalizedCommandContribution = z.infer<
    typeof pluginLocalizedCommandContributionSchema
  >;
  ```

  然后把 `pluginLocaleMessagesSchema`（line 32）的 `commands` 字段从

  ```ts
    commands: z
      .record(z.string().min(1), pluginLocalizedContributionSchema)
      .optional(),
  ```

  改为

  ```ts
    commands: z
      .record(z.string().min(1), pluginLocalizedCommandContributionSchema)
      .optional(),
  ```

  `panels` / `terminalStatusItems` 两个 record 保持旧 schema 不动（设计文档 §3.2 i18n 只给 commands 条目加 category）。

- [ ] **Step 2: 确认 main 侧 locale 合并层类型兼容（只验证，不改码）。** `src/main/services/plugin-localization.ts:53-65` 的 `mergeContributionMessages` 参数类型写死为 `PluginLocaleMessages["commands"]` 且同时被 panels / terminalStatusItems 复用（line 83–87）。由于 `category` 是可选字段，`Record<string, PluginLocalizedContribution>` 与 `Record<string, PluginLocalizedCommandContribution>` 双向可赋值，且 line 47–48 的 `...base, ...overlay` 展开在运行时天然保留 `category`。跑 `pnpm typecheck` 确认无报错；若报错则把 `mergeContributionMessages` 与 `mergeLocalizedContribution` 泛型化处理（预期不需要）。

- [ ] **Step 3: display.ts 增加 category 解析。** 在 `src/renderer/lib/plugins/display.ts` 中，于 line 15–18 的 `PluginContributionDisplayText` 之后插入：

  ```ts
  export interface PluginCommandDisplayText
    extends PluginContributionDisplayText {
    category?: string;
  }
  ```

  把 line 136–156 的 `resolvePluginCommandDisplay` 整体替换为：

  ```ts
  export function resolvePluginCommandDisplay(
    manifest: PluginManifest,
    command: PluginCommandContribution,
    locale: string
  ): PluginCommandDisplayText {
    const category =
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.commands?.[command.id]?.category
      ) ?? command.category;
    const description =
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.commands?.[command.id]?.description
      ) ?? command.description;
    return {
      title:
        resolveFromLocales(
          manifest,
          locale,
          (messages) => messages.commands?.[command.id]?.title
        ) ?? command.title,
      ...(category ? { category } : {}),
      ...(description ? { description } : {}),
    };
  }
  ```

  既有调用方 `src/renderer/lib/plugins/host-context.ts:54,62` 只消费 `.title` / `.description`，返回类型加可选字段不破坏它们。

- [ ] **Step 4: 写单测。** 创建 `tests/unit/plugins/command-category.test.ts`（vitest.config.ts 已配 `@` / `@shared` 别名）：

  ```ts
  import { describe, expect, it } from "vitest";
  import { resolvePluginCommandDisplay } from "@/lib/plugins/display.ts";
  import {
    type PluginManifest,
    pluginLocaleMessagesSchema,
    pluginManifestSchema,
  } from "@shared/contracts/plugin.ts";

  const COMMAND_ID = "pier.test.cmd";

  function makeManifest(): PluginManifest {
    return pluginManifestSchema.parse({
      apiVersion: 1,
      commands: [{ category: "Fallback", id: COMMAND_ID, title: "Cmd" }],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      locales: {
        "zh-CN": {
          commands: {
            [COMMAND_ID]: { category: "分类", title: "命令" },
          },
        },
      },
      name: "Test",
      source: { kind: "builtin" },
      version: "1.0.0",
    });
  }

  describe("plugin command category i18n", () => {
    it("accepts category in locale command entries", () => {
      const parsed = pluginLocaleMessagesSchema.parse({
        commands: { [COMMAND_ID]: { category: "Git", title: "T" } },
      });
      expect(parsed.commands?.[COMMAND_ID]?.category).toBe("Git");
    });

    it("rejects empty category strings", () => {
      const result = pluginLocaleMessagesSchema.safeParse({
        commands: { [COMMAND_ID]: { category: "", title: "T" } },
      });
      expect(result.success).toBe(false);
    });

    it("resolves category from the active locale", () => {
      const manifest = makeManifest();
      const command = manifest.commands[0];
      expect(command).toBeDefined();
      if (!command) {
        return;
      }
      const display = resolvePluginCommandDisplay(manifest, command, "zh-CN");
      expect(display.category).toBe("分类");
      expect(display.title).toBe("命令");
    });

    it("falls back to the manifest category when the locale has none", () => {
      const manifest = makeManifest();
      const command = manifest.commands[0];
      expect(command).toBeDefined();
      if (!command) {
        return;
      }
      const display = resolvePluginCommandDisplay(manifest, command, "en");
      expect(display.category).toBe("Fallback");
    });

    it("omits category when neither locale nor manifest declares one", () => {
      const manifest = pluginManifestSchema.parse({
        apiVersion: 1,
        commands: [{ id: COMMAND_ID, title: "Cmd" }],
        engines: { pier: ">=0.1.0" },
        id: "pier.test",
        name: "Test",
        source: { kind: "builtin" },
        version: "1.0.0",
      });
      const command = manifest.commands[0];
      expect(command).toBeDefined();
      if (!command) {
        return;
      }
      const display = resolvePluginCommandDisplay(manifest, command, "en");
      expect(display.category).toBeUndefined();
    });
  });
  ```

  （`command` 的 defined 守卫是 `noUncheckedIndexedAccess` 下的合规写法，不用非空断言。）

- [ ] **Step 5: 验证。** 跑 `pnpm test:unit -- command-category`，5 个用例全绿；再跑 `pnpm check`，确认 typecheck / lint / depcruise / file-size 全过。

---

### Task 2: pier.git manifest 补 homepage/repository + 两份 locale 补 category 翻译（+ 守护单测）

**Files:**

- Modify: `src/plugins/builtin/git/manifest.ts`（line 89 `engines` 之后插入 `homepage`；line 117 `publisher: "Pier",` 之后插入 `repository`，维持对象键字母序）
- Modify: `src/plugins/builtin/git/locales/en.json`（line 2–105 的 `commands` 块，13 个条目各加 `"category"`）
- Modify: `src/plugins/builtin/git/locales/zh-CN.json`（line 2–97 的 `commands` 块，同上）
- Test: Create `tests/unit/plugins/git-manifest-links.test.ts`

**Interfaces:**

- Consumes:
  - `pluginManifestSchema` 已有可选字段 `homepage`（`plugin.ts:94`）与 `repository`（`plugin.ts:104`），均 `z.string().min(1).optional()`，无需改 schema
  - Task 1 产出的 `pluginLocalizedCommandContributionSchema`（locale JSON 里的 `category` 依赖它才不会被 Zod strip）
  - `GIT_PLUGIN_MANIFEST: PluginManifest`（`src/plugins/builtin/git/manifest.ts:6`）
- Produces:
  - `GIT_PLUGIN_MANIFEST.homepage === "https://github.com/runloom/pier"`、`GIT_PLUGIN_MANIFEST.repository === "https://github.com/runloom/pier"`
  - en/zh-CN locale 中每个命令条目含 `category`（en：`"Git"` / `"Worktree"`；zh-CN：`"Git"` / `"工作树"`）

- [ ] **Step 1: 确认仓库真实远程地址。** 运行：

  ```bash
  git remote get-url origin
  ```

  预期输出 `git@github.com:runloom/pier.git`（计划编写时已核实），对应 https 形式 `https://github.com/runloom/pier`。若输出不同，把下一步里的两个 URL 换成实际输出的 https 归一化形式（`git@github.com:<owner>/<repo>.git` → `https://github.com/<owner>/<repo>`），后续步骤与测试中的 URL 同步替换。

- [ ] **Step 2: manifest 补两个字段。** 在 `src/plugins/builtin/git/manifest.ts` 中，line 89 `engines: { pier: ">=0.1.0" },` 与 line 90 `id: SHARED_GIT_PLUGIN_ID,` 之间插入：

  ```ts
  homepage: "https://github.com/runloom/pier",
  ```

  line 117 `publisher: "Pier",` 与 line 118 `source: { kind: "builtin" },` 之间插入：

  ```ts
  repository: "https://github.com/runloom/pier",
  ```

- [ ] **Step 3: en.json 补 category。** 把 `src/plugins/builtin/git/locales/en.json` 的顶层 `"commands"` 对象整体替换为下面内容（每条在 `"aliases"` 之后插入 `"category"`，键序维持字母序；worktree 四条为 `"Worktree"`，其余九条为 `"Git"`；`title` / `description` / `aliases` 原值一字不动）：

  ```json
  {
    "pier.git.changes.open": {
      "aliases": ["git changes", "open changes"],
      "category": "Git",
      "title": "Git: Open Changes"
    },
    "pier.git.merge": {
      "aliases": ["git merge", "merge branch", "branch merge"],
      "category": "Git",
      "description": "Select a branch and merge it into the current branch.",
      "title": "Merge Branch..."
    },
    "pier.git.mergeAbort": {
      "aliases": ["git merge abort", "abort merge"],
      "category": "Git",
      "description": "Abort the current merge operation.",
      "title": "Abort Merge"
    },
    "pier.git.stash": {
      "aliases": ["git stash", "stash save"],
      "category": "Git",
      "description": "Stash local changes, including untracked files.",
      "title": "Stash"
    },
    "pier.git.stashPop": {
      "aliases": [
        "git stash pop",
        "git stash apply",
        "pop stash",
        "apply stash",
        "restore stash"
      ],
      "category": "Git",
      "description": "Select a stash, apply it, and remove it from the stash list.",
      "title": "Pop Stash..."
    },
    "pier.git.rebase": {
      "aliases": ["git rebase", "rebase branch"],
      "category": "Git",
      "description": "Select a branch and rebase the current branch onto it.",
      "title": "Rebase Branch..."
    },
    "pier.git.rebaseAbort": {
      "aliases": ["git rebase abort", "abort rebase"],
      "category": "Git",
      "description": "Abort the current rebase operation.",
      "title": "Abort Rebase"
    },
    "pier.git.rebaseContinue": {
      "aliases": ["git rebase continue", "continue rebase"],
      "category": "Git",
      "description": "Continue the current rebase operation.",
      "title": "Continue Rebase"
    },
    "pier.git.undoLastCommit": {
      "aliases": [
        "undo commit",
        "git undo",
        "git reset",
        "git reset soft",
        "reset commit",
        "undo last commit"
      ],
      "category": "Git",
      "description": "Undo the last commit while preserving its changes as staged.",
      "title": "Undo Last Commit"
    },
    "pier.worktree.create": {
      "aliases": [
        "worktree",
        "worktree create",
        "worktree add",
        "git worktree add",
        "new worktree",
        "create worktree"
      ],
      "category": "Worktree",
      "description": "Creates a Git worktree under the repository-managed worktrees directory.",
      "title": "Create Worktree"
    },
    "pier.worktree.delete": {
      "aliases": [
        "worktree",
        "worktree delete",
        "worktree remove",
        "git worktree remove",
        "remove worktree",
        "delete worktree"
      ],
      "category": "Worktree",
      "description": "Selects and removes a Git worktree.",
      "title": "Delete Worktrees..."
    },
    "pier.worktree.prune": {
      "aliases": [
        "worktree",
        "worktree prune",
        "git worktree prune",
        "cleanup worktree"
      ],
      "category": "Worktree",
      "description": "Prunes stale Git worktree entries.",
      "title": "Prune Stale Worktrees"
    },
    "pier.worktree.list": {
      "aliases": [
        "worktree",
        "worktree list",
        "git worktree",
        "git worktree list",
        "workspace worktree"
      ],
      "category": "Worktree",
      "description": "Lists Git worktrees for the current repository and opens the selected worktree.",
      "title": "List Worktrees"
    }
  }
  ```

  文件其余部分（`description` / `messages` / `panels` / `terminalStatusItems` / `name`）不动。

- [ ] **Step 4: zh-CN.json 补 category。** 把 `src/plugins/builtin/git/locales/zh-CN.json` 的顶层 `"commands"` 对象整体替换为（Git 类保持 `"Git"`，Worktree 类译为 `"工作树"`；其余字段原值不动）：

  ```json
  {
    "pier.git.changes.open": {
      "aliases": ["变更", "打开变更面板", "biangeng"],
      "category": "Git",
      "title": "Git: 打开变更面板"
    },
    "pier.git.merge": {
      "aliases": ["合并分支", "git merge", "he bing fen zhi"],
      "category": "Git",
      "description": "选择一个分支并合并到当前分支。",
      "title": "合并分支..."
    },
    "pier.git.mergeAbort": {
      "aliases": ["中止合并", "git merge abort", "zhong zhi he bing"],
      "category": "Git",
      "description": "中止当前合并操作。",
      "title": "中止合并"
    },
    "pier.git.stash": {
      "aliases": ["暂存更改", "git stash", "zan cun geng gai"],
      "category": "Git",
      "description": "储藏本地变更，包含未跟踪文件。",
      "title": "暂存更改"
    },
    "pier.git.stashPop": {
      "aliases": [
        "弹出暂存",
        "恢复暂存",
        "恢复",
        "git stash pop",
        "tan chu zan cun",
        "hui fu zan cun"
      ],
      "category": "Git",
      "description": "选择一个储藏，应用并从储藏列表移除。",
      "title": "弹出暂存..."
    },
    "pier.git.rebase": {
      "aliases": ["变基到分支", "git rebase", "bian ji fen zhi"],
      "category": "Git",
      "description": "选择一个分支并将当前分支变基到它之上。",
      "title": "变基到分支..."
    },
    "pier.git.rebaseAbort": {
      "aliases": ["中止变基", "git rebase abort", "zhong zhi bian ji"],
      "category": "Git",
      "description": "中止当前变基操作。",
      "title": "中止变基"
    },
    "pier.git.rebaseContinue": {
      "aliases": ["继续变基", "git rebase continue", "ji xu bian ji"],
      "category": "Git",
      "description": "继续当前变基操作。",
      "title": "继续变基"
    },
    "pier.git.undoLastCommit": {
      "aliases": [
        "撤销上次提交",
        "回退提交",
        "回退",
        "undo commit",
        "che xiao ti jiao",
        "hui tui ti jiao"
      ],
      "category": "Git",
      "description": "撤销上次提交，并保留变更为已暂存。",
      "title": "撤销上次提交"
    },
    "pier.worktree.create": {
      "aliases": [
        "工作树",
        "创建工作树",
        "gongzuoshu",
        "chuangjian gongzuoshu"
      ],
      "category": "工作树",
      "description": "在仓库托管的工作树目录下创建 Git worktree。",
      "title": "创建工作树"
    },
    "pier.worktree.delete": {
      "aliases": [
        "工作树",
        "删除工作树",
        "移除工作树",
        "gongzuoshu",
        "shanchu gongzuoshu"
      ],
      "category": "工作树",
      "description": "选择并删除 Git worktree。",
      "title": "删除工作树..."
    },
    "pier.worktree.prune": {
      "aliases": [
        "工作树",
        "清理工作树",
        "worktree prune",
        "qing li gong zuo shu"
      ],
      "category": "工作树",
      "description": "清理失效的 Git worktree 记录。",
      "title": "清理工作树"
    },
    "pier.worktree.list": {
      "aliases": ["工作树", "工作树列表", "gongzuoshu", "gong zuo shu"],
      "category": "工作树",
      "description": "列出当前仓库的 Git worktree 并打开目标工作树。",
      "title": "工作树列表"
    }
  }
  ```

- [ ] **Step 5: 写守护单测。** 创建 `tests/unit/plugins/git-manifest-links.test.ts`（文件读取方式参照同目录 `builtin-git-package.test.ts:5` 的 `process.cwd()` 定位法）：

  ```ts
  import { readFile } from "node:fs/promises";
  import { join } from "node:path";
  import { describe, expect, it } from "vitest";
  import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
  import { pluginLocaleMessagesSchema } from "@shared/contracts/plugin.ts";

  const LOCALES_DIR = join(process.cwd(), "src/plugins/builtin/git/locales");
  const LOCALE_FILES = ["en.json", "zh-CN.json"];

  describe("git plugin manifest links and locale categories", () => {
    it("declares https homepage and repository", () => {
      expect(GIT_PLUGIN_MANIFEST.homepage).toBe(
        "https://github.com/runloom/pier"
      );
      expect(GIT_PLUGIN_MANIFEST.repository).toBe(
        "https://github.com/runloom/pier"
      );
    });

    it("localizes a category for every manifest command in every locale", async () => {
      for (const file of LOCALE_FILES) {
        const raw: unknown = JSON.parse(
          await readFile(join(LOCALES_DIR, file), "utf8")
        );
        const messages = pluginLocaleMessagesSchema.parse(raw);
        for (const command of GIT_PLUGIN_MANIFEST.commands) {
          expect(
            messages.commands?.[command.id]?.category,
            `${file} is missing category for ${command.id}`
          ).toBeTruthy();
        }
      }
    });
  });
  ```

- [ ] **Step 6: 验证。** 跑 `pnpm test:unit -- git-manifest-links`（2 个用例全绿，13 个命令 × 2 locale 全覆盖），再跑 `pnpm test:unit -- builtin-git-package` 确认既有边界测试未被破坏，最后 `pnpm check` 全过。

---

### Task 3: renderer 设置页 i18n 新键（en + zh-CN）

**Files:**

- Modify: `src/renderer/i18n/locales/en/settings.ts`（`plugins` 块内，line 157 `publisher: "Publisher",` 之后插入）
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts`（`plugins` 块内，line 154 `publisher: "发布者",` 之后插入）

**Interfaces:**

- Consumes: 现有键 `settings.plugins.pluginId` / `version` / `publisher` / `commands` / `panels` / `terminalStatusItems` / `permissions` / `none`（两文件均已存在，位置见上）
- Produces: 新 i18n 键（Task 5 消费）：
  - `settings.plugins.homepage`、`settings.plugins.repository`
  - `settings.plugins.table.title`、`settings.plugins.table.id`、`settings.plugins.table.category`、`settings.plugins.table.description`

- [ ] **Step 1: en 键。** 在 `src/renderer/i18n/locales/en/settings.ts` 的 `plugins` 对象内，`publisher: "Publisher",`（line 157）与 `contributionSummary: {` 之间插入：

  ```ts
      homepage: "Homepage",
      repository: "Repository",
      table: {
        category: "Category",
        description: "Description",
        id: "ID",
        title: "Title",
      },
  ```

- [ ] **Step 2: zh-CN 键。** 在 `src/renderer/i18n/locales/zh-CN/settings.ts` 的 `plugins` 对象内，`publisher: "发布者",`（line 154）与 `contributionSummary: {` 之间插入：

  ```ts
      homepage: "主页",
      repository: "仓库",
      table: {
        category: "分类",
        description: "描述",
        id: "ID",
        title: "标题",
      },
  ```

  两份文件的 `plugins` 块键结构必须保持一致（项目无自动 parity 校验，靠人工对照；插入位置相同即可）。

- [ ] **Step 3: 验证。** 跑 `pnpm check` 全过（此时新键尚无消费方，属正常——i18next 资源对象不做 unused 检查）。

---

### Task 4: 新建通用 ContributionTable 组件

**Files:**

- Create: `src/renderer/pages/settings/components/contribution-table.tsx`

**Interfaces:**

- Consumes: `Table` / `TableBody` / `TableCell` / `TableHead` / `TableHeader` / `TableRow`（`packages/ui/src/table.tsx:107-116` 导出，import 路径 `@pier/ui/table.tsx`）
- Produces（**Phase 3 复用的硬接口，不可改**）:

  ```ts
  export function ContributionTable(props: {
    headers: string[];
    rows: ReactNode[][];
  }): react JSX element
  ```

  隐含契约（Phase 3 也须遵守）：`headers` 内字符串必须互不相同（用作列 key）；`rows` 每行 cells 数量应等于 `headers.length`；列数由 `headers` 决定，多余 cell 被忽略、缺失 cell 渲染为空。

- [ ] **Step 1: 写组件。** 创建 `src/renderer/pages/settings/components/contribution-table.tsx`，完整内容：

  ```tsx
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@pier/ui/table.tsx";
  import type { ReactNode } from "react";

  export function ContributionTable({
    headers,
    rows,
  }: {
    headers: string[];
    rows: ReactNode[][];
  }) {
    return (
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {headers.map((header) => (
              <TableHead
                className="h-7 px-2 font-medium text-muted-foreground text-xs"
                key={header}
              >
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((cells, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows 是每次渲染重建的静态展示数据，行序即身份；硬接口 ReactNode[][] 无稳定 id 可用
            <TableRow className="hover:bg-transparent" key={rowIndex}>
              {headers.map((header, columnIndex) => (
                <TableCell
                  className="whitespace-normal px-2 py-1.5 align-top"
                  key={header}
                >
                  {cells[columnIndex]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }
  ```

  设计要点：紧凑密度靠 `h-7`（表头，覆盖默认 `h-10`）与 `px-2 py-1.5`（单元格，覆盖默认 `p-2`）+ 整表 `text-xs`；`whitespace-normal` 覆盖 `TableCell` 默认 `whitespace-nowrap`，让描述列可换行；cell 迭代以 `headers` 为基准、以 header 字符串为 key，天然避开第二处 index-key；`cells[columnIndex]` 在 `noUncheckedIndexedAccess` 下类型为 `ReactNode | undefined`，`undefined` 是合法 children，无需断言。

- [ ] **Step 2: 格式与静态检查。** 跑 `pnpm lint:fix`（让 Biome 按 useSortedClasses 等规则归一化 class 顺序与 import 顺序），然后 `pnpm check` 全过。确认 biome-ignore 注释未被报 unused suppression（若报 unused 说明规则未命中，直接删除该注释改用 `key={rowIndex}` 原样保留）。

---

### Task 5: plugin-details.tsx 表格化重构 + plugins-section.tsx 调用方更新 + 人工验证

**Files:**

- Modify: `src/renderer/pages/settings/components/plugin-details.tsx`（全文件重写，现 222 行：删除 line 10–13 `ContributionBadge`、line 15–44 三个 badge 构造函数、line 46–72 `ContributionBadgeList`、line 150–167 `ContributionSection`；重写 line 125–148 `PluginMeta` 与 line 169–221 `PluginDetails`；保留 line 74–113 `countLabel`/`contributionSummary` 与 line 115–123 `permissionLabel` 原样）
- Modify: `src/renderer/pages/settings/components/plugins-section.tsx`（line 42–48 import 块、line 97–105 三个 contributions 计算处；line 178–187 的 `PluginDetails` 挂载处 prop 名不变、无需改动）
- Test: 纯 JSX 展示改动，无单测；`pnpm dev` 人工验证（Step 4 检查单）

**Interfaces:**

- Consumes:
  - `ContributionTable`（Task 4）
  - `resolvePluginCommandDisplay: (manifest, command, locale) => PluginCommandDisplayText`（Task 1）、`resolvePluginPanelDisplay` / `resolvePluginTerminalStatusItemDisplay: (manifest, item, locale) => PluginContributionDisplayText`（`display.ts:170,192`，不变）
  - i18n 键 `settings.plugins.homepage` / `repository` / `table.*`（Task 3）
  - `PluginRegistryEntry.manifest.homepage?` / `.repository?`（Task 2 起 pier.git 有值）
  - 外链先例：`agent-row.tsx:217-228` 的 `<a target="_blank" rel="noreferrer">` + lucide `ExternalLink`（main 侧 `window-manager.ts:281-282` 已把新窗口请求转 `shell.openExternal`）
- Produces（`plugin-details.tsx` 新导出面，替代原 `ContributionBadge` + `*ContributionBadges`）:

  ```ts
  export interface CommandContributionRow { category?: string; id: string; title: string }
  export interface PanelContributionRow { description?: string; id: string; title: string }
  export type TerminalStatusContributionRow = PanelContributionRow;
  export function commandContributionRows(entry: PluginRegistryEntry, locale: string): CommandContributionRow[]
  export function panelContributionRows(entry: PluginRegistryEntry, locale: string): PanelContributionRow[]
  export function terminalStatusContributionRows(entry: PluginRegistryEntry, locale: string): TerminalStatusContributionRow[]
  export function contributionSummary(entry: PluginRegistryEntry, t: ReturnType<typeof useT>): string   // 保持不变
  export function PluginDetails(props: { commandContributions: CommandContributionRow[]; entry: PluginRegistryEntry; panelContributions: PanelContributionRow[]; terminalStatusContributions: TerminalStatusContributionRow[] }): react JSX element
  ```

- [ ] **Step 1: 重写 plugin-details.tsx。** 用以下完整内容替换 `src/renderer/pages/settings/components/plugin-details.tsx` 全文：

  ```tsx
  import { Badge } from "@pier/ui/badge.tsx";
  import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
  import { ExternalLink } from "lucide-react";
  import type { ReactNode } from "react";
  import { useT } from "@/i18n/use-t.ts";
  import {
    resolvePluginCommandDisplay,
    resolvePluginPanelDisplay,
    resolvePluginTerminalStatusItemDisplay,
  } from "@/lib/plugins/display.ts";
  import { ContributionTable } from "./contribution-table.tsx";

  export interface CommandContributionRow {
    category?: string;
    id: string;
    title: string;
  }

  export interface PanelContributionRow {
    description?: string;
    id: string;
    title: string;
  }

  export type TerminalStatusContributionRow = PanelContributionRow;

  export function commandContributionRows(
    entry: PluginRegistryEntry,
    locale: string
  ): CommandContributionRow[] {
    return entry.manifest.commands.map((command) => {
      const display = resolvePluginCommandDisplay(
        entry.manifest,
        command,
        locale
      );
      return {
        id: command.id,
        title: display.title,
        ...(display.category ? { category: display.category } : {}),
      };
    });
  }

  export function panelContributionRows(
    entry: PluginRegistryEntry,
    locale: string
  ): PanelContributionRow[] {
    return entry.manifest.panels.map((panel) => {
      const display = resolvePluginPanelDisplay(entry.manifest, panel, locale);
      return {
        id: panel.id,
        title: display.title,
        ...(display.description ? { description: display.description } : {}),
      };
    });
  }

  export function terminalStatusContributionRows(
    entry: PluginRegistryEntry,
    locale: string
  ): TerminalStatusContributionRow[] {
    return entry.manifest.terminalStatusItems.map((item) => {
      const display = resolvePluginTerminalStatusItemDisplay(
        entry.manifest,
        item,
        locale
      );
      return {
        id: item.id,
        title: display.title,
        ...(display.description ? { description: display.description } : {}),
      };
    });
  }

  function countLabel(
    count: number,
    singularKey: string,
    pluralKey: string,
    t: ReturnType<typeof useT>
  ): string | null {
    if (count === 0) {
      return null;
    }
    return t(count === 1 ? singularKey : pluralKey, { count });
  }

  export function contributionSummary(
    entry: PluginRegistryEntry,
    t: ReturnType<typeof useT>
  ) {
    const parts = [
      countLabel(
        entry.manifest.commands.length,
        "settings.plugins.contributionSummary.command",
        "settings.plugins.contributionSummary.commands",
        t
      ),
      countLabel(
        entry.manifest.panels.length,
        "settings.plugins.contributionSummary.panel",
        "settings.plugins.contributionSummary.panels",
        t
      ),
      countLabel(
        entry.manifest.terminalStatusItems.length,
        "settings.plugins.contributionSummary.terminalStatusItem",
        "settings.plugins.contributionSummary.terminalStatusItems",
        t
      ),
    ].filter(Boolean);
    return parts.length > 0
      ? parts.join(" · ")
      : t("settings.plugins.contributionSummary.none");
  }

  function permissionLabel(
    permission: string,
    t: ReturnType<typeof useT>
  ): string {
    return t(`settings.plugins.permissionLabels.${permission}`, {
      defaultValue: permission,
      nsSeparator: false,
    });
  }

  function isHttpUrl(value: string): boolean {
    return value.startsWith("https://") || value.startsWith("http://");
  }

  interface PluginMetaRow {
    href?: string;
    label: string;
    value: string;
  }

  function pluginMetaRows(
    entry: PluginRegistryEntry,
    t: ReturnType<typeof useT>
  ): PluginMetaRow[] {
    const rows: PluginMetaRow[] = [
      { label: t("settings.plugins.pluginId"), value: entry.manifest.id },
      { label: t("settings.plugins.version"), value: entry.manifest.version },
      {
        label: t("settings.plugins.publisher"),
        value: entry.manifest.publisher ?? t("settings.plugins.none"),
      },
    ];
    if (entry.manifest.homepage) {
      rows.push({
        label: t("settings.plugins.homepage"),
        value: entry.manifest.homepage,
        ...(isHttpUrl(entry.manifest.homepage)
          ? { href: entry.manifest.homepage }
          : {}),
      });
    }
    if (entry.manifest.repository) {
      rows.push({
        label: t("settings.plugins.repository"),
        value: entry.manifest.repository,
        ...(isHttpUrl(entry.manifest.repository)
          ? { href: entry.manifest.repository }
          : {}),
      });
    }
    return rows;
  }

  function PluginMeta({ entry }: { entry: PluginRegistryEntry }) {
    const t = useT();
    return (
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        {pluginMetaRows(entry, t).map((row) => (
          <div className="min-w-0" key={row.label}>
            <div className="font-medium text-muted-foreground">{row.label}</div>
            {row.href ? (
              <a
                className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
                href={row.href}
                rel="noreferrer"
                target="_blank"
                title={row.value}
              >
                <span className="truncate">{row.value}</span>
                <ExternalLink aria-hidden className="size-3 shrink-0" />
              </a>
            ) : (
              <div className="truncate" title={row.value}>
                {row.value}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  function ContributionTableSection({
    headers,
    rows,
    title,
  }: {
    headers: string[];
    rows: ReactNode[][];
    title: string;
  }) {
    if (rows.length === 0) {
      return null;
    }
    return (
      <div className="min-w-0">
        <div className="mb-1 font-medium text-muted-foreground">{title}</div>
        <ContributionTable headers={headers} rows={rows} />
      </div>
    );
  }

  function idCell(id: string): ReactNode {
    return (
      <code className="whitespace-nowrap font-mono" key={`${id}-id`}>
        {id}
      </code>
    );
  }

  export function PluginDetails({
    commandContributions,
    entry,
    panelContributions,
    terminalStatusContributions,
  }: {
    commandContributions: CommandContributionRow[];
    entry: PluginRegistryEntry;
    panelContributions: PanelContributionRow[];
    terminalStatusContributions: TerminalStatusContributionRow[];
  }) {
    const t = useT();
    const commandRows: ReactNode[][] = commandContributions.map((row) => [
      row.title,
      idCell(row.id),
      row.category ?? "",
    ]);
    const panelRows: ReactNode[][] = panelContributions.map((row) => [
      row.title,
      idCell(row.id),
      row.description ?? "",
    ]);
    const terminalStatusRows: ReactNode[][] = terminalStatusContributions.map(
      (row) => [row.title, idCell(row.id), row.description ?? ""]
    );

    return (
      <div className="basis-full space-y-4 border-border/60 border-t pt-3 text-xs">
        <PluginMeta entry={entry} />
        <ContributionTableSection
          headers={[
            t("settings.plugins.table.title"),
            t("settings.plugins.table.id"),
            t("settings.plugins.table.category"),
          ]}
          rows={commandRows}
          title={t("settings.plugins.commands")}
        />
        <ContributionTableSection
          headers={[
            t("settings.plugins.table.title"),
            t("settings.plugins.table.id"),
            t("settings.plugins.table.description"),
          ]}
          rows={panelRows}
          title={t("settings.plugins.panels")}
        />
        <ContributionTableSection
          headers={[
            t("settings.plugins.table.title"),
            t("settings.plugins.table.id"),
            t("settings.plugins.table.description"),
          ]}
          rows={terminalStatusRows}
          title={t("settings.plugins.terminalStatusItems")}
        />
        <div className="min-w-0">
          <div className="mb-1 font-medium text-muted-foreground">
            {t("settings.plugins.permissions")}
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.effectivePermissions.length > 0 ? (
              entry.effectivePermissions.map((permission) => (
                <Badge key={permission} title={permission} variant="outline">
                  {permissionLabel(permission, t)}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">
                {t("settings.plugins.none")}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

  要点对照范围要求：`md:grid-cols-2` 双列网格已移除，四个区块经外层 `space-y-4` 纵向堆叠；三张表无贡献时 `ContributionTableSection` 返回 `null` 整区隐藏；权限保留 chips 单独一行（含原 `none` 空态）；ID 列经 `idCell` 用 `<code className="whitespace-nowrap font-mono">` 等宽渲染（`key` 是 Biome `useJsxKeyInIterable` 对数组字面量中 JSX 的要求）；元数据 5 项复用原 grid，homepage/repository 仅当为 http(s) URL 时渲染为外链。

- [ ] **Step 2: 更新调用方 plugins-section.tsx。** 把 line 42–48 的 import 块

  ```ts
  import {
    commandContributionBadges,
    contributionSummary,
    PluginDetails,
    panelContributionBadges,
    terminalStatusContributionBadges,
  } from "./plugin-details.tsx";
  ```

  改为

  ```ts
  import {
    commandContributionRows,
    contributionSummary,
    PluginDetails,
    panelContributionRows,
    terminalStatusContributionRows,
  } from "./plugin-details.tsx";
  ```

  把 line 97–105 的三处计算

  ```ts
    const commandContributions = commandContributionBadges(
      entry,
      i18next.language
    );
    const panelContributions = panelContributionBadges(entry, i18next.language);
    const terminalStatusContributions = terminalStatusContributionBadges(
      entry,
      i18next.language
    );
  ```

  改为

  ```ts
    const commandContributions = commandContributionRows(
      entry,
      i18next.language
    );
    const panelContributions = panelContributionRows(entry, i18next.language);
    const terminalStatusContributions = terminalStatusContributionRows(
      entry,
      i18next.language
    );
  ```

  line 178–187 的 `<PluginDetails commandContributions={...} entry={...} panelContributions={...} terminalStatusContributions={...} />` prop 名不变，类型由新导出接口自动收窄，无需改动。

- [ ] **Step 3: 静态检查。** 跑 `pnpm lint:fix`，再 `pnpm check` 全过；全仓 grep 确认 `ContributionBadge`、`commandContributionBadges`、`panelContributionBadges`、`terminalStatusContributionBadges`、`ContributionBadgeList` 已无任何残留引用。

- [ ] **Step 4: pnpm dev 人工验证。** 跑 `pnpm dev`（worktree 首启需先 `pnpm setup:worktree`），打开设置对话框 → 左侧导航「插件」→ Git 行点「详情」展开，逐项检查：
  1. **元数据行**：显示 插件 ID `pier.git`、版本 `1.0.0`、发布者 `Pier`、主页与仓库两条均为 `https://github.com/runloom/pier`，链接为主题色、尾随外链图标；点击任一链接在**系统浏览器**打开（不在 Electron 内导航）。
  2. **命令表**：三列表头（en：Title | ID | Category），13 行；ID 列等宽字体；Category 列 9 行 `Git`、4 行 `Worktree`；无 badge 残留。
  3. **面板表**：1 行 `Git Changes` / `pier.git.changes` / 描述 "Placeholder panel for upcoming git change preview."。
  4. **终端状态项表**：1 行 `Worktree Status` / `pier.worktree.status` / 描述 "Shows the current Git worktree in terminal panels."。
  5. **权限**：仍为 chips（8 枚 badge），单独一行在最后。
  6. **布局**：四个区块纵向堆叠，无双列网格；窗口拉窄时表格不撑破容器（`Table` 外层自带 `overflow-x-auto`）。
  7. **i18n**：设置 → 外观切语言到 简体中文，重新展开详情——表头变为 标题 | ID | 分类/描述，分类列显示 `Git` / `工作树`，元数据标签变为 主页 / 仓库；切回 English 复原。
  8. **空区隐藏**：无法在唯一内置插件上直接观察（pier.git 三类贡献均非空），以代码审查确认 `ContributionTableSection` 的 `rows.length === 0 → null` 分支即可。
  9. 打开 devtools console，确认无 React key 告警、无 i18next missingKey 告警。

- [ ] **Step 5: 收尾验证。** 跑 `pnpm test:unit`（全量，确认 Task 1/2 新测试与既有 `builtin-git-package` / `git-plugin` 等测试全绿），再跑 `pnpm check` 全过。按 AGENTS.md §05，不自行 commit；如用户要求提交，stage 明确路径（本 Phase 全部改动文件见各 Task Files 列表）并展示 `git diff --staged` 与拟用 message（建议 `feat(plugins): tabular plugin details with command categories and manifest links`）等待确认。
