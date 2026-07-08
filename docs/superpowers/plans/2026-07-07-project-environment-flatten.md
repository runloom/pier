# 项目环境配置铺平实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `local-environments.json` 的"项目 → 多环境 → 选择"三层结构铺平为"项目一份配置"，并把 Settings → Environment 重写为单栏编辑器 + 顶部项目切换器；同步更新命令契约、preload、renderer store、插件 facade、worktree 生命周期、i18n、测试。

**Architecture:** `LocalEnvironmentProject` 直接持 `setupCommand / cleanupCommand / env`，删除 `LocalEnvironmentProfile` / `environments[]` / `selectedEnvironmentId` / `environmentId` 全链路概念；`worktreeBindings` 保留但只记录 `{ projectRootPath, worktreePath, createdAt }`，语义收敛为"Pier 建了这个 worktree、归属哪个项目"，用于 worktree 删除时判定是否跑 cleanup；UI 用单栏编辑器 + `DropdownMenu` 项目切换器 + `+ Add folder` 直连 folder picker。

**Tech Stack:** Electron 42, React 19, TypeScript 6 strict, Vitest 4, Testing Library, Tailwind v4, `@pier/ui` shadcn primitives, Zod 4。

## Global Constraints

- `src/plugins/builtin/*` 只能 import `src/plugins/api` + `src/shared` + `packages/ui`。
- 所有面向用户的确认弹窗走 `showAppConfirm` / `showAppAlert`；短确认弹窗必须显式传 `size: "sm"`；破坏性动作必须显式传 `intent: "destructive"`。
- 不允许 `@ts-ignore`、`@ts-expect-error`、`as any` 压制类型。
- Git 默认只读；本次实施不涉及 commit，不做 `git add .`。
- 单元 / 组件测试使用 `pnpm vitest run <path>`；不跑 `pnpm test` 全量套件，最后一次跑 `pnpm check` + `pnpm test:e2e tests/e2e/startup-stability.spec.ts`。
- 遵循 file-size cap：单文件软上限 300 行、硬上限 500 行；env 编辑器拆分为 `environment-section.tsx` / `environment-editor.tsx` / `environment-vars-table.tsx` 三份。
- i18n 新增 key 必须同时更新 `en` 与 `zh-CN`。
- 项目尚未发布，不做任何数据迁移或兼容 code path；旧 schema 相关字段直接删除。

---

## File Structure

- Modify `src/shared/contracts/environment.ts` — 铺平 project schema、删 profile / id / create / select schema、修改 update / binding-snapshot schema。
- Modify `src/shared/contracts/worktree.ts` — 从 `worktreeCreateRequestSchema` 与 `worktreeCreateResultSchema` 移除 `environmentId`。
- Modify `src/shared/contracts/commands.ts` — 删 `environment.create` / `environment.select` 分支，更新 `environment.update` payload。
- Modify `tests/unit/shared/environment-contract.test.ts` — 新 schema 断言 + 旧字段拒绝断言。
- Modify `src/main/services/local-environments-service.ts` — 铺平 CRUD、重命名 `updateEnvironment → updateProject`、`resolveForCreate → resolveProject`、`resolveForWorktree` 与 `bindWorktree` 与 `worktreeBinding` 调整。
- Modify `tests/unit/main/local-environments-service.test.ts` — 覆盖新签名与判定分支。
- Modify `src/main/app-core/environment-commands.ts` — 删 create / select 分支、调整 update 分支。
- Modify `src/main/app-core/worktree-commands.ts` — 用 `resolveProject`；`bindWorktree` 不传 `environmentId`；从 `worktree.create` 结果与 lifecycle 里去掉 environment 概念，改为传递整份 project 配置。
- Modify `src/preload/environment-api.ts` — 删 `create` / `select`，调整 `update` / `worktreeBinding`。
- Modify `src/plugins/api/renderer.ts` — 删 `environments.create`；调整 `update` / `worktreeBinding` 类型。
- Modify `src/renderer/lib/plugins/host-environments-context.ts` — 删 `create` facade。
- Modify `src/plugins/builtin/git/renderer/worktree-create-overlay.tsx` — 删 environment picker 与 `CREATE_LOCAL_ENVIRONMENT` 分支；`worktrees.create` 不再传 `environmentId`。
- Modify `src/plugins/builtin/git/renderer/worktree-create-form.tsx` — 删 environment badge。
- Modify `src/plugins/builtin/git/renderer/worktree-operation-actions.ts` — 删除 `environmentName / environmentId` 依赖；cleanup 提示改为"项目 setup / cleanup"。
- Modify `src/renderer/stores/local-environments.store.ts` — 删 `createEnvironment` / `selectEnvironment`；`updateEnvironment → updateProject`。
- Modify `tests/unit/renderer/stores/local-environments-store.test.ts` — 覆盖新 store 方法。
- Create `src/renderer/pages/settings/components/environment-vars-table.tsx` — KV 表组件。
- Create `tests/component/environment-vars-table.test.tsx` — KV 表组件测试。
- Rewrite `src/renderer/pages/settings/components/environment-editor.tsx` — 单份 project 配置的表单 + 脏态检测。
- Rewrite `src/renderer/pages/settings/components/environment-section.tsx` — 顶部项目切换器 + 空态 + focus 判定 + 脏态守卫。
- Modify `tests/unit/renderer/settings-dialog-environment.test.tsx` — 重写全部用例覆盖新交互。
- Modify `src/renderer/i18n/locales/en/settings.ts` 与 `src/renderer/i18n/locales/zh-CN/settings.ts` — 删旧 key、加新 key。
- Modify `src/plugins/builtin/git/locales/en.json` 与 `zh-CN.json` — 若 `deleteCleanupWarning` 文案里提到 environment name，改为项目名。

---

## Task 1: 契约铺平

**Files:**
- Modify: `src/shared/contracts/environment.ts`
- Modify: `src/shared/contracts/worktree.ts`
- Modify: `src/shared/contracts/commands.ts`
- Test: `tests/unit/shared/environment-contract.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  ```ts
  // environment.ts
  export const localEnvironmentProjectSchema = z.object({
    cleanupCommand: z.string().max(12_000).default(""),
    env: z.record(terminalLaunchEnvKeySchema, z.string()).default({}),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000).default(""),
    updatedAt: z.number().int().nonnegative(),
  }).strict();

  export const localEnvironmentWorktreeBindingSchema = z.object({
    createdAt: z.number().int().nonnegative(),
    projectRootPath: z.string().min(1),
    worktreePath: z.string().min(1),
  }).strict();

  export const localEnvironmentStateSchema = z.object({
    projects: z.array(localEnvironmentProjectSchema).default([]),
    version: z.literal(1).default(1),
    worktreeBindings: z.array(localEnvironmentWorktreeBindingSchema).default([]),
  }).strict();

  export const environmentUpdateRequestSchema = z.object({
    cleanupCommand: z.string().max(12_000),
    env: z.record(terminalLaunchEnvKeySchema, z.string()),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000),
  }).strict();

  export const localEnvironmentWorktreeBindingSnapshotSchema = z.object({
    cleanupCommand: z.string().max(12_000),
    env: z.record(terminalLaunchEnvKeySchema, z.string()),
    hasCleanupScript: z.boolean(),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000),
    worktreePath: z.string().min(1),
  }).strict();
  ```
- Deleted exports: `localEnvironmentIdSchema`, `localEnvironmentProfileSchema`, `environmentCreateRequestSchema`, `environmentSelectRequestSchema`, and types `LocalEnvironmentProfile`, `EnvironmentCreateRequest`, `EnvironmentSelectRequest`.
- `worktreeCreateRequestSchema` 与 `worktreeCreateResultSchema` 不再有 `environmentId` 字段。
- `commands.ts` 中 `environment.create` / `environment.select` 分支删除；`environment.update` 用新 payload。

- [ ] **Step 1: 重写 `tests/unit/shared/environment-contract.test.ts` 断言新 schema**

  用如下断言完全替换原文件：

  ```ts
  import {
    environmentUpdateRequestSchema,
    localEnvironmentProjectSchema,
    localEnvironmentStateSchema,
    localEnvironmentWorktreeBindingSchema,
    localEnvironmentWorktreeBindingSnapshotSchema,
  } from "@shared/contracts/environment.ts";
  import { describe, expect, it } from "vitest";

  function project(overrides: Record<string, unknown> = {}): unknown {
    return {
      cleanupCommand: "pnpm cleanup:worktree",
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "pnpm setup:worktree",
      updatedAt: 1,
      ...overrides,
    };
  }

  describe("local environment contracts", () => {
    it("accepts a flat project with setup, cleanup and env", () => {
      expect(localEnvironmentProjectSchema.parse(project())).toEqual({
        cleanupCommand: "pnpm cleanup:worktree",
        env: { NODE_ENV: "development" },
        projectRootPath: "/repo/pier",
        setupCommand: "pnpm setup:worktree",
        updatedAt: 1,
      });
    });

    it("rejects legacy fields on project", () => {
      expect(() =>
        localEnvironmentProjectSchema.parse(
          project({ environments: [], selectedEnvironmentId: null })
        )
      ).toThrow();
    });

    it("rejects setup and cleanup longer than 12,000 characters", () => {
      const tooLong = "x".repeat(12_001);
      expect(() =>
        localEnvironmentProjectSchema.parse(project({ setupCommand: tooLong }))
      ).toThrow();
      expect(() =>
        localEnvironmentProjectSchema.parse(project({ cleanupCommand: tooLong }))
      ).toThrow();
    });

    it("rejects env keys that terminal launch env would reject", () => {
      expect(() =>
        localEnvironmentProjectSchema.parse(
          project({ env: { "1NODE_ENV": "development" } })
        )
      ).toThrow();
    });

    it("accepts a binding without environmentId and rejects one with", () => {
      const binding = {
        createdAt: 1,
        projectRootPath: "/repo/pier",
        worktreePath: "/repo/pier.worktree/feature",
      };
      expect(localEnvironmentWorktreeBindingSchema.parse(binding)).toEqual(binding);
      expect(() =>
        localEnvironmentWorktreeBindingSchema.parse({ ...binding, environmentId: "pier" })
      ).toThrow();
    });

    it("accepts a state with a project and a binding", () => {
      const state = {
        projects: [project()],
        version: 1,
        worktreeBindings: [
          {
            createdAt: 1,
            projectRootPath: "/repo/pier",
            worktreePath: "/repo/pier.worktree/feature",
          },
        ],
      };
      expect(localEnvironmentStateSchema.parse(state)).toEqual(state);
    });

    it("accepts flattened update payload without environmentId or name", () => {
      const payload = {
        cleanupCommand: "cleanup",
        env: { NODE_ENV: "development" },
        projectRootPath: "/repo/pier",
        setupCommand: "setup",
      };
      expect(environmentUpdateRequestSchema.parse(payload)).toEqual(payload);
      expect(() =>
        environmentUpdateRequestSchema.parse({ ...payload, environmentId: "pier" })
      ).toThrow();
      expect(() =>
        environmentUpdateRequestSchema.parse({ ...payload, name: "Pier" })
      ).toThrow();
    });

    it("accepts binding snapshot with flattened setup/cleanup/env", () => {
      const snapshot = {
        cleanupCommand: "cleanup",
        env: { NODE_ENV: "development" },
        hasCleanupScript: true,
        projectRootPath: "/repo/pier",
        setupCommand: "setup",
        worktreePath: "/repo/pier.worktree/feature",
      };
      expect(
        localEnvironmentWorktreeBindingSnapshotSchema.parse(snapshot)
      ).toEqual(snapshot);
      expect(() =>
        localEnvironmentWorktreeBindingSnapshotSchema.parse({
          ...snapshot,
          environmentId: "pier",
        })
      ).toThrow();
    });
  });
  ```

- [ ] **Step 2: 运行契约测试确认全部红**

  Run: `pnpm vitest run tests/unit/shared/environment-contract.test.ts`

  Expected: 至少 5 个失败（旧 schema 允许旧字段、`environmentUpdateRequestSchema` 仍要求 `environmentId`、`localEnvironmentIdSchema` 尚未删除）。

- [ ] **Step 3: 重写 `src/shared/contracts/environment.ts`**

  用如下内容完全替换文件：

  ```ts
  import { z } from "zod";
  import { terminalLaunchEnvKeySchema } from "./terminal-launch.ts";

  export const localEnvironmentProjectSchema = z
    .object({
      cleanupCommand: z.string().max(12_000).default(""),
      env: z.record(terminalLaunchEnvKeySchema, z.string()).default({}),
      projectRootPath: z.string().min(1),
      setupCommand: z.string().max(12_000).default(""),
      updatedAt: z.number().int().nonnegative(),
    })
    .strict();

  export const localEnvironmentWorktreeBindingSchema = z
    .object({
      createdAt: z.number().int().nonnegative(),
      projectRootPath: z.string().min(1),
      worktreePath: z.string().min(1),
    })
    .strict();

  export const localEnvironmentStateSchema = z
    .object({
      projects: z.array(localEnvironmentProjectSchema).default([]),
      version: z.literal(1).default(1),
      worktreeBindings: z
        .array(localEnvironmentWorktreeBindingSchema)
        .default([]),
    })
    .strict();

  export const environmentSnapshotRequestSchema = z
    .object({ projectRootPath: z.string().min(1).optional() })
    .strict();

  export const environmentProjectRequestSchema = z
    .object({ projectRootPath: z.string().min(1) })
    .strict();

  export const environmentUpdateRequestSchema = z
    .object({
      cleanupCommand: z.string().max(12_000),
      env: z.record(terminalLaunchEnvKeySchema, z.string()),
      projectRootPath: z.string().min(1),
      setupCommand: z.string().max(12_000),
    })
    .strict();

  export const environmentWorktreeBindingRequestSchema = z
    .object({ worktreePath: z.string().min(1) })
    .strict();

  export const localEnvironmentWorktreeBindingSnapshotSchema = z
    .object({
      cleanupCommand: z.string().max(12_000),
      env: z.record(terminalLaunchEnvKeySchema, z.string()),
      hasCleanupScript: z.boolean(),
      projectRootPath: z.string().min(1),
      setupCommand: z.string().max(12_000),
      worktreePath: z.string().min(1),
    })
    .strict();

  export type LocalEnvironmentProject = z.infer<
    typeof localEnvironmentProjectSchema
  >;
  export type LocalEnvironmentWorktreeBinding = z.infer<
    typeof localEnvironmentWorktreeBindingSchema
  >;
  export type LocalEnvironmentState = z.infer<typeof localEnvironmentStateSchema>;
  export type EnvironmentSnapshotRequest = z.infer<
    typeof environmentSnapshotRequestSchema
  >;
  export type EnvironmentProjectRequest = z.infer<
    typeof environmentProjectRequestSchema
  >;
  export type EnvironmentUpdateRequest = z.infer<
    typeof environmentUpdateRequestSchema
  >;
  export type EnvironmentWorktreeBindingRequest = z.infer<
    typeof environmentWorktreeBindingRequestSchema
  >;
  export type LocalEnvironmentWorktreeBindingSnapshot = z.infer<
    typeof localEnvironmentWorktreeBindingSnapshotSchema
  >;
  ```

- [ ] **Step 4: 更新 `src/shared/contracts/worktree.ts`**

  - 删除 `import { localEnvironmentIdSchema }` 相关 import。
  - 从 `worktreeCreateRequestSchema` 移除 `environmentId` 字段。
  - 从 `worktreeCreateResultSchema` 移除 `environmentId` 字段。

- [ ] **Step 5: 更新 `src/shared/contracts/commands.ts`**

  - 删除 `environmentCreateRequestSchema` / `environmentSelectRequestSchema` 的 import。
  - 从 `pierCommandSchema` 的 `discriminatedUnion` 移除 `environment.create` 与 `environment.select` 两个分支。
  - `environment.update` 分支改为 `environmentUpdateRequestSchema.extend({ type: z.literal("environment.update") })`（结构已变，无需再改写但要确保 import 正确）。

- [ ] **Step 6: 运行契约测试确认全绿**

  Run: `pnpm vitest run tests/unit/shared/environment-contract.test.ts`

  Expected: 全部通过。

- [ ] **Step 7: 运行 typecheck 观察被下游 broken 的调用点**

  Run: `pnpm typecheck`

  Expected: 报错集中在 `local-environments-service.ts` / `environment-commands.ts` / `worktree-commands.ts` / `preload/environment-api.ts` / renderer 一侧的 store / 组件，这些是后续 Task 的范围。**不要修**，记录错误列表作为 Task 2-9 的输入。

---

## Task 2: 主进程 service 铺平

**Files:**
- Modify: `src/main/services/local-environments-service.ts`
- Test: `tests/unit/main/local-environments-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的新 schema 与类型。
- Produces:
  ```ts
  export class LocalEnvironmentServiceError extends Error {
    readonly reason = "project_not_found" as const;
    constructor(message: string) {
      super(message);
      this.name = "LocalEnvironmentServiceError";
    }
  }

  export interface LocalEnvironmentService {
    addProject(request: EnvironmentProjectRequest): Promise<LocalEnvironmentState>;
    bindWorktree(request: { projectRootPath: string; worktreePath: string }): Promise<void>;
    clearWorktreeBinding(worktreePath: string): Promise<void>;
    projectSnapshot(projectRootPath: string): Promise<LocalEnvironmentProject | null>;
    removeProject(request: EnvironmentProjectRequest): Promise<LocalEnvironmentState>;
    resolveProject(projectRootPath: string): Promise<LocalEnvironmentProject | null>;
    resolveForWorktree(worktreePath: string): Promise<{ project: LocalEnvironmentProject; projectRootPath: string } | null>;
    runLifecycle(request: {
      cwd: string;
      project: LocalEnvironmentProject;
      phase: LocalEnvironmentLifecyclePhase;
    }): Promise<void>;
    snapshot(request?: EnvironmentSnapshotRequest): Promise<LocalEnvironmentState>;
    updateProject(request: EnvironmentUpdateRequest): Promise<LocalEnvironmentState>;
    worktreeBinding(request: EnvironmentWorktreeBindingRequest): Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
  }
  ```
- Deleted methods: `createEnvironment`, `selectEnvironment`, `updateEnvironment`, `resolveForCreate`；`bindWorktree` 签名变更。
- `runLocalEnvironmentLifecycle` 内部签名如果原本接受 `LocalEnvironmentProfile`，改为接受 `{ setupCommand, cleanupCommand, env }` 的最小子集或整个 project；本任务同步适配 `src/main/services/local-environment-scripts.ts`（仅改类型注解与解构，不改运行逻辑）。

- [ ] **Step 1: 重写 `tests/unit/main/local-environments-service.test.ts`**

  用新签名替换现有 CRUD 用例。核心场景：

  ```ts
  it("addProject creates a new flat project with empty commands and env", async () => {
    const state = await service.addProject({ projectRootPath: "/repo/pier" });
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]).toEqual(
      expect.objectContaining({
        cleanupCommand: "",
        env: {},
        projectRootPath: "/repo/pier",
        setupCommand: "",
      })
    );
  });

  it("addProject is idempotent and bumps updatedAt", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    const before = (await service.snapshot()).projects[0].updatedAt;
    await service.addProject({ projectRootPath: "/repo/pier" });
    const after = (await service.snapshot()).projects[0].updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it("updateProject trims setup/cleanup and drops empty env keys", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    const state = await service.updateProject({
      cleanupCommand: "  pnpm cleanup:worktree  ",
      env: { "  NODE_ENV  ": "development", "": "ignored" },
      projectRootPath: "/repo/pier",
      setupCommand: "  pnpm setup:worktree  ",
    });
    expect(state.projects[0]).toEqual(
      expect.objectContaining({
        cleanupCommand: "pnpm cleanup:worktree",
        env: { NODE_ENV: "development" },
        setupCommand: "pnpm setup:worktree",
      })
    );
  });

  it("updateProject throws project_not_found when project is absent", async () => {
    await expect(
      service.updateProject({
        cleanupCommand: "",
        env: {},
        projectRootPath: "/repo/missing",
        setupCommand: "",
      })
    ).rejects.toEqual(
      expect.objectContaining({ reason: "project_not_found" })
    );
  });

  it("bindWorktree records only projectRootPath and worktreePath", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    await service.bindWorktree({
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    });
    const state = await service.snapshot();
    expect(state.worktreeBindings).toEqual([
      expect.objectContaining({
        projectRootPath: "/repo/pier",
        worktreePath: "/repo/pier.worktree/feature",
      }),
    ]);
    expect(state.worktreeBindings[0]).not.toHaveProperty("environmentId");
  });

  it("bindWorktree replaces an existing binding for the same worktreePath", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    await service.addProject({ projectRootPath: "/repo/other" });
    await service.bindWorktree({
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    });
    await service.bindWorktree({
      projectRootPath: "/repo/other",
      worktreePath: "/repo/pier.worktree/feature",
    });
    const state = await service.snapshot();
    expect(state.worktreeBindings).toHaveLength(1);
    expect(state.worktreeBindings[0].projectRootPath).toBe("/repo/other");
  });

  it("resolveForWorktree returns the bound project", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    await service.updateProject({
      cleanupCommand: "cleanup",
      env: { NODE_ENV: "test" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    });
    await service.bindWorktree({
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    });
    const result = await service.resolveForWorktree(
      "/repo/pier.worktree/feature"
    );
    expect(result?.projectRootPath).toBe("/repo/pier");
    expect(result?.project.setupCommand).toBe("setup");
  });

  it("resolveForWorktree returns null when no binding exists", async () => {
    const result = await service.resolveForWorktree("/repo/nowhere");
    expect(result).toBeNull();
  });

  it("worktreeBinding returns flat snapshot with hasCleanupScript flag", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    await service.updateProject({
      cleanupCommand: "cleanup",
      env: { PORT: "5173" },
      projectRootPath: "/repo/pier",
      setupCommand: "",
    });
    await service.bindWorktree({
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    });
    const snapshot = await service.worktreeBinding({
      worktreePath: "/repo/pier.worktree/feature",
    });
    expect(snapshot).toEqual({
      cleanupCommand: "cleanup",
      env: { PORT: "5173" },
      hasCleanupScript: true,
      projectRootPath: "/repo/pier",
      setupCommand: "",
      worktreePath: "/repo/pier.worktree/feature",
    });
  });

  it("worktreeBinding returns null when the binding is missing", async () => {
    const snapshot = await service.worktreeBinding({
      worktreePath: "/repo/nowhere",
    });
    expect(snapshot).toBeNull();
  });

  it("removeProject removes the project and its bindings", async () => {
    await service.addProject({ projectRootPath: "/repo/pier" });
    await service.bindWorktree({
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    });
    const state = await service.removeProject({ projectRootPath: "/repo/pier" });
    expect(state.projects).toHaveLength(0);
    expect(state.worktreeBindings).toHaveLength(0);
  });
  ```

  同步删除所有引用 `createEnvironment` / `selectEnvironment` / `updateEnvironment` / `resolveForCreate` / `environments[]` / `selectedEnvironmentId` / `environmentId` 的既有用例。

- [ ] **Step 2: 运行 service 测试确认全红**

  Run: `pnpm vitest run tests/unit/main/local-environments-service.test.ts`

  Expected: 全部失败（signature 不匹配、`project_not_found` 尚未存在）。

- [ ] **Step 3: 重写 `src/main/services/local-environments-service.ts`**

  按 Interfaces 中的 signature 实现。关键改动：

  - `LocalEnvironmentServiceError.reason` 从 `"environment_not_found"` 改为 `"project_not_found"`。
  - 删除 `findEnvironment` helper。
  - `addProject` 在新增项目时不再初始化 `environments` 与 `selectedEnvironmentId`。
  - `updateProject` 对项目做 in-place 更新 `setupCommand / cleanupCommand / env`；env 键清洗逻辑保留（`trim + drop empty + terminalLaunchEnvKeySchema`）。
  - `bindWorktree` 只写 `{ createdAt, projectRootPath, worktreePath }`。
  - `resolveForWorktree` 返回 `{ project, projectRootPath }`。
  - `resolveProject(projectRootPath)`: 返回 `findProject(state, safeRealpath(projectRootPath)) ?? null`；不再区分 create 时的 environmentId 语义。
  - `worktreeBinding` 组装的 snapshot 用 `project.setupCommand / cleanupCommand / env`；`hasCleanupScript = project.cleanupCommand.trim() !== ""`；binding 命中但 project 不存在时返回 `null`（而不是 stale 元数据，因为不再有环境级 id 用作 stale 展示锚点）。

- [ ] **Step 4: 更新 `src/main/services/local-environment-scripts.ts` 类型注解**

  把 `runLocalEnvironmentLifecycle` 内部 `environment: LocalEnvironmentProfile` 参数改为直接从 project 拿 `setupCommand / cleanupCommand / env`。若签名原本以 `environment` 命名，可改为 `project: LocalEnvironmentProject` 或结构解构。不改变 spawn / 执行行为。

- [ ] **Step 5: 更新 service 单测里的 lifecycle 依赖注入**

  把 `service.runLifecycle({ cwd, environment, phase })` 相关的 stub / mock 改为 `service.runLifecycle({ cwd, project, phase })`。

- [ ] **Step 6: 运行 service 测试确认全绿**

  Run: `pnpm vitest run tests/unit/main/local-environments-service.test.ts`

- [ ] **Step 7: 运行 lifecycle 脚本测试保底**

  Run: `pnpm vitest run tests/unit/main/local-environment-scripts.test.ts`

  Expected: 通过；若有 signature 断裂，同步修正测试引用。

---

## Task 3: 命令路由与 worktree 生命周期

**Files:**
- Modify: `src/main/app-core/environment-commands.ts`
- Modify: `src/main/app-core/worktree-commands.ts`
- Test: `tests/unit/app-core/command-router.test.ts`
- Test: `tests/unit/main/worktree-service.test.ts`（如果存在，覆盖 create / remove 路径）

**Interfaces:**
- Consumes: Task 2 的 `resolveProject` / `bindWorktree({ projectRootPath, worktreePath })` / `runLifecycle({ cwd, project, phase })`。
- Produces:
  - `environment-commands.ts` 只处理 `environment.snapshot / project.add / project.remove / update / worktreeBinding`；`LocalEnvironmentServiceError` 映射到 `not_found`（保留原有映射，只是 reason 字面量变了）。
  - `worktree-commands.ts` 中 `worktree.create` 分支：
    - 移除 `environmentRequest` 与 `environmentId` 相关分支。
    - 不再消费 `command.environmentId`。
    - 生命周期决策：`const project = await services.localEnvironments.resolveProject(check.mainPath); const shouldRunSetup = project !== null && project.setupCommand.trim() !== "";`
    - `bindWorktree({ projectRootPath: check.mainPath, worktreePath: created.targetPath })` **无条件**在 worktree 成功创建后调用（对齐 spec：Pier 建的 worktree 都写 binding）。
    - `runLifecycle({ cwd: created.targetPath, project, phase: "setup" })` 只在 `shouldRunSetup` 时调用。
    - `worktree.create` 结果不再包含 `environmentId`（对应 Task 1 已从 schema 移除）。
  - `worktree.remove` 分支：`resolveForWorktree` 返回 `{ project, projectRootPath }`；只有 `project.cleanupCommand.trim() !== ""` 时才 `runLifecycle(phase: "cleanup")`；无论是否运行 cleanup 都调 `clearWorktreeBinding`。

- [ ] **Step 1: 更新 `src/main/app-core/environment-commands.ts`**

  完全替换 switch 分支：

  ```ts
  switch (command.type) {
    case "environment.snapshot": {
      const { type: _t, ...request } = command;
      return success(requestId, await services.localEnvironments.snapshot(request));
    }
    case "environment.project.add": {
      const { type: _t, ...request } = command;
      const state = await services.localEnvironments.addProject(request);
      onChanged?.(state);
      return success(requestId, state);
    }
    case "environment.project.remove": {
      const { type: _t, ...request } = command;
      const state = await services.localEnvironments.removeProject(request);
      onChanged?.(state);
      return success(requestId, state);
    }
    case "environment.update": {
      const { type: _t, ...request } = command;
      const state = await services.localEnvironments.updateProject(request);
      onChanged?.(state);
      return success(requestId, state);
    }
    case "environment.worktreeBinding": {
      const { type: _t, ...request } = command;
      return success(
        requestId,
        await services.localEnvironments.worktreeBinding(request)
      );
    }
    default:
      return null;
  }
  ```

  错误分支保留原样即可（`LocalEnvironmentServiceError` 仍走 `not_found`）。

- [ ] **Step 2: 更新 `src/main/app-core/worktree-commands.ts` 的 `executeWorktreeCreateCommand`**

  按 Interfaces 中的决策改写 create 分支。参考骨架：

  ```ts
  const check = await services.worktrees.check({ path: command.path });
  if (check.status !== "supported") {
    const created = await services.worktrees.create(command);
    const copiedFiles = await copyCreateIncludes(created, services);
    services.gitWatch.pulse(command.path);
    return success(requestId, { ...created, copiedFiles });
  }

  const project = await services.localEnvironments.resolveProject(check.mainPath);
  const shouldRunSetup = project !== null && project.setupCommand.trim() !== "";

  let created: WorktreeCreateResult | null = null;
  try {
    created = await services.worktrees.create(command);
    await services.localEnvironments.bindWorktree({
      projectRootPath: check.mainPath,
      worktreePath: created.targetPath,
    });
    const copiedFiles = await copyCreateIncludes(created, services);
    if (shouldRunSetup && project) {
      await services.localEnvironments.runLifecycle({
        cwd: created.targetPath,
        phase: "setup",
        project,
      });
    }
    return success(requestId, { ...created, copiedFiles });
  } catch (err) {
    // 原有 rollback 逻辑保留：若 created 已成功但 lifecycle 失败，尝试 remove worktree。
    …
  }
  ```

  从 `worktree.create` 返回体去掉 `environmentId` 字段（schema 已删）。

- [ ] **Step 3: 更新 `worktree.remove` 分支**

  ```ts
  const binding = await services.localEnvironments.resolveForWorktree(targetPath);
  if (binding && binding.project.cleanupCommand.trim() !== "") {
    await services.localEnvironments.runLifecycle({
      cwd: targetPath,
      phase: "cleanup",
      project: binding.project,
    });
  }
  await services.localEnvironments.clearWorktreeBinding(removed.removedPath);
  ```

  保留 `services.gitWatch.pulse(command.path)`。

- [ ] **Step 4: 运行 command router 与 worktree 相关测试**

  Run: `pnpm vitest run tests/unit/app-core tests/unit/main/worktree-service.test.ts`

  Expected: 若原用例断言 `environmentId` / `environmentName`，同步删除或改为断言 `projectRootPath`。所有测试通过。

- [ ] **Step 5: 运行 typecheck**

  Run: `pnpm typecheck`

  Expected: 主进程侧类型全绿；剩余错误集中在 preload / renderer，交给后续 Task。

---

## Task 4: preload 与插件 facade

**Files:**
- Modify: `src/preload/environment-api.ts`
- Modify: `src/plugins/api/renderer.ts`
- Modify: `src/renderer/lib/plugins/host-environments-context.ts`

**Interfaces:**
- Consumes: Task 1 契约。
- Produces:
  - `window.pier.environments` 接口只保留 `snapshot / project.{add,remove} / update / worktreeBinding / pickProjectDirectory / onChanged`。
  - `RendererPluginContext.environments` 只保留 `snapshot / projectSnapshot / update / worktreeBinding`。
  - 所有 `create` / `select` 相关 API 与 facade 方法删除。
  - `worktreeBinding` 返回体使用 Task 1 定义的新 snapshot 类型。

- [ ] **Step 1: 更新 `src/preload/environment-api.ts`**

  删除 `create` / `select` 方法与对应的 `type` 常量，`update` payload 换成新的 `EnvironmentUpdateRequest`。

- [ ] **Step 2: 更新 `src/plugins/api/renderer.ts`**

  在 `PierEnvironmentsPluginAPI`（或对应接口）里删除 `create`，`update` 类型改为新的 `EnvironmentUpdateRequest`；`worktreeBinding` 返回类型换成新 snapshot。

- [ ] **Step 3: 更新 `src/renderer/lib/plugins/host-environments-context.ts`**

  ```ts
  export function createPluginEnvironmentsContext(
    entry: PluginRegistryEntry | undefined,
    assertPluginCapability: AssertPluginCapability
  ): RendererPluginContext["environments"] {
    return {
      projectSnapshot: (projectRootPath) => {
        assertPluginCapability(entry, "environment:read");
        return window.pier.environments
          .snapshot({ projectRootPath })
          .then((state) => state.projects[0] ?? null);
      },
      snapshot: (request) => {
        assertPluginCapability(entry, "environment:read");
        return window.pier.environments.snapshot(request);
      },
      update: (request) => {
        assertPluginCapability(entry, "environment:write");
        return window.pier.environments.update(request);
      },
      worktreeBinding: (request) => {
        assertPluginCapability(entry, "environment:read");
        return window.pier.environments.worktreeBinding(request);
      },
    };
  }
  ```

  确保移除 `create`，`update` 走新 payload。

- [ ] **Step 4: 更新相关单测**

  运行 `pnpm vitest run tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/plugin-service.test.ts` 观察断裂：

  - 删除断言 `environments.create` 存在的用例。
  - 断言 `environments.update` 时改用新 payload。
  - 断言 `manifest` 里 `environment:write` capability 覆盖 `update`（不再包含 `create`）。

  Expected：跑通所有插件 host / service 相关测试。

- [ ] **Step 5: 运行 typecheck**

  Run: `pnpm typecheck`

  Expected: preload / plugin API 侧类型全绿；剩余错误集中在 UI 与 store。

---

## Task 5: worktree 创建 / 删除 UI 清理

**Files:**
- Modify: `src/plugins/builtin/git/renderer/worktree-create-overlay.tsx`
- Modify: `src/plugins/builtin/git/renderer/worktree-create-form.tsx`
- Modify: `src/plugins/builtin/git/renderer/worktree-operation-actions.ts`
- Modify: `src/plugins/builtin/git/locales/en.json`
- Modify: `src/plugins/builtin/git/locales/zh-CN.json`
- Test: `tests/component/worktree-create-overlay.test.tsx`（现有）
- Test: `tests/unit/renderer/worktree-operation-actions.test.ts`（现有）

**Interfaces:**
- Consumes: Task 4 的插件 facade。
- Produces:
  - Worktree 创建 overlay 不再展示 environment picker / `+ Create local environment` 分支；提交时 `context.worktrees.create` 不传 `environmentId`。
  - `worktree-create-form.tsx` 的 badge 只在 `defaults.copyPatterns.length > 0` 时渲染 copy 提示；不再有 environment 相关 badge。
  - `worktree-operation-actions.ts` 中删除 worktree 的确认文案改为项目视角，例如 "Cleanup will run for project \"{{name}}\"."，`{{name}}` 从 `binding.projectRootPath` 派生的 basename 取。
  - 相关 i18n key 删除或改名：`ui.worktreeCreate.environmentNone` / `environmentCreateLocal` / `environmentLabel` 等旧 key 全部删除；`ui.worktreeDelete.cleanupWarning` 文案 placeholder 改为项目名。

- [ ] **Step 1: 简化 `worktree-create-overlay.tsx`**

  - 删除 `NO_ENVIRONMENT / CREATE_LOCAL_ENVIRONMENT` 常量、`environmentId` state 与 setter、Select 组件相关 JSX。
  - `context.worktrees.create({ ... })` 调用去掉 `environmentId` 字段。
  - `WorktreeCreateForm` prop 中删除 `environmentName`。

- [ ] **Step 2: 简化 `worktree-create-form.tsx`**

  - 删除 `environmentName` 参数与相关 badge JSX。
  - `SetupPreview` 仅在 `defaults.copyPatterns.length > 0` 时渲染 copy 提示；无 copy 时返回 `null`。

- [ ] **Step 3: 更新 `worktree-operation-actions.ts` 的删除确认文案**

  ```ts
  const binding = await context.environments
    .worktreeBinding({ worktreePath: worktree.path })
    .catch(() => null);
  if (binding?.hasCleanupScript) {
    const projectLabel = projectBasename(binding.projectRootPath);
    confirmMessage +=
      "\n" +
      pluginText(
        context,
        "deleteCleanupWarning",
        "Cleanup will run for project \u201c{{name}}\u201d.",
        { name: projectLabel }
      );
  }
  ```

  在文件内导入或就地实现 `projectBasename`（可以直接 inline `path.split(/[\\/]/).filter(Boolean).at(-1) ?? path`，无需从 UI 层引入）。

- [ ] **Step 4: 更新 `en.json` 与 `zh-CN.json`**

  - 删除 `ui.worktreeCreate.environmentNone / environmentCreateLocal / environmentLabel` 等旧 key（若存在）。
  - 更新 `ui.worktreeDelete.cleanupWarning` 与 `ui.worktreeCreate.prepareSetupEnv`：文案 placeholder 由 environment 相关词改为 project；`prepareSetupEnv` 若不再被使用则删除。

- [ ] **Step 5: 更新 overlay / actions 组件测试**

  - 删除断言 environment picker 存在与切换的用例。
  - 新增断言：`worktrees.create` 调用参数不包含 `environmentId`；删除确认文案 mock 命中 project 名而不是 environment 名。

- [ ] **Step 6: 运行相关测试**

  Run: `pnpm vitest run tests/component/worktree-create-overlay.test.tsx tests/unit/renderer/worktree-operation-actions.test.ts`

  Expected: 全绿。

---

## Task 6: renderer store 铺平

**Files:**
- Modify: `src/renderer/stores/local-environments.store.ts`
- Test: `tests/unit/renderer/stores/local-environments-store.test.ts`

**Interfaces:**
- Consumes: Task 4 的 preload API。
- Produces:
  ```ts
  interface LocalEnvironmentsStoreState extends LocalEnvironmentState {
    addProject: (request: { projectRootPath: string }) => Promise<LocalEnvironmentState>;
    removeProject: (request: { projectRootPath: string }) => Promise<LocalEnvironmentState>;
    updateProject: (request: EnvironmentUpdateRequest) => Promise<LocalEnvironmentState>;
    worktreeBinding: (request: { worktreePath: string }) => Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
  }
  ```
  删除 `createEnvironment` / `selectEnvironment` / `updateEnvironment` 方法与所有 wrapper。`hydrate` 广播行为不变。

- [ ] **Step 1: 更新 store 单测**

  重写为断言新的方法名与 payload：

  ```ts
  it("addProject dispatches through window.pier.environments.project.add", async () => {
    vi.mocked(window.pier.environments.project.add).mockResolvedValueOnce(PROJECT_SNAPSHOT);
    const store = useLocalEnvironmentsStore.getState();
    await store.addProject({ projectRootPath: "/repo/pier" });
    expect(window.pier.environments.project.add).toHaveBeenCalledWith({ projectRootPath: "/repo/pier" });
    expect(useLocalEnvironmentsStore.getState().projects).toEqual(PROJECT_SNAPSHOT.projects);
  });

  it("updateProject sends flat payload without environmentId or name", async () => {
    const state = useLocalEnvironmentsStore.getState();
    await state.updateProject({
      cleanupCommand: "cleanup",
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    });
    expect(window.pier.environments.update).toHaveBeenCalledWith({
      cleanupCommand: "cleanup",
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    });
  });
  ```

  删除所有 `createEnvironment / selectEnvironment` 用例。

- [ ] **Step 2: 运行 store 测试确认红**

  Run: `pnpm vitest run tests/unit/renderer/stores/local-environments-store.test.ts`

- [ ] **Step 3: 重写 store**

  用新 interface 替换。`hydrate` 广播、`initLocalEnvironments`、`detachLocalEnvironmentsListener` 逻辑保留。

- [ ] **Step 4: 运行 store 测试确认绿**

  Run: `pnpm vitest run tests/unit/renderer/stores/local-environments-store.test.ts`

---

## Task 7: 环境变量 KV 表组件

**Files:**
- Create: `src/renderer/pages/settings/components/environment-vars-table.tsx`
- Create: `tests/component/environment-vars-table.test.tsx`

**Interfaces:**
- Consumes: 无外部依赖。
- Produces:
  ```ts
  export interface EnvVarRow {
    id: string;
    key: string;
    value: string;
  }

  export interface EnvironmentVarsTableProps {
    onChange: (rows: EnvVarRow[]) => void;
    rows: EnvVarRow[];
  }

  export function EnvironmentVarsTable(props: EnvironmentVarsTableProps): JSX.Element;

  export function createEnvVarRow(key?: string, value?: string): EnvVarRow;
  export function envToRows(env: Record<string, string>): EnvVarRow[];
  export function rowsToEnv(rows: EnvVarRow[]): Record<string, string>;
  export function envRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean;
  ```
  这些 helper 从旧 `environment-editor.tsx` 迁出，供 editor 复用。

- [ ] **Step 1: 写组件测试**

  ```ts
  it("renders one row per env entry and always shows a trailing add button", () => {
    const rows = envToRows({ NODE_ENV: "development", PORT: "5173" });
    render(<EnvironmentVarsTable onChange={() => {}} rows={rows} />);
    expect(screen.getAllByPlaceholderText("KEY")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("value")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /add variable/i })).toBeInTheDocument();
  });

  it("emits new rows array when adding a variable", async () => {
    const rows = envToRows({ NODE_ENV: "development" });
    const onChange = vi.fn();
    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);
    await userEvent.click(screen.getByRole("button", { name: /add variable/i }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: "NODE_ENV", value: "development" }),
      expect.objectContaining({ key: "", value: "" }),
    ]));
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });

  it("emits new rows array when deleting a row", async () => {
    const rows = envToRows({ NODE_ENV: "development", PORT: "5173" });
    const onChange = vi.fn();
    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);
    await userEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ key: "PORT", value: "5173" }),
    ]);
  });

  it("emits new rows array when editing key or value", async () => {
    const rows = envToRows({ NODE_ENV: "development" });
    const onChange = vi.fn();
    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);
    await userEvent.type(screen.getByPlaceholderText("value"), "-x");
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ key: "NODE_ENV", value: "development-x" }),
    ]);
  });

  it("rowsToEnv drops rows with empty keys after trimming", () => {
    expect(
      rowsToEnv([
        createEnvVarRow(" NODE_ENV ", "development"),
        createEnvVarRow("", "ignored"),
      ])
    ).toEqual({ NODE_ENV: "development" });
  });

  it("envRecordsEqual is order insensitive", () => {
    expect(envRecordsEqual({ A: "1", B: "2" }, { B: "2", A: "1" })).toBe(true);
    expect(envRecordsEqual({ A: "1" }, { A: "2" })).toBe(false);
  });
  ```

- [ ] **Step 2: 运行组件测试确认红**

  Run: `pnpm vitest run tests/component/environment-vars-table.test.tsx`

- [ ] **Step 3: 实现组件**

  - `Input` 用 `@pier/ui/input.tsx`；`Button` 用 `@pier/ui/button.tsx`。
  - Layout：`div.grid.grid-cols-[160px_1fr_auto].gap-2` 每行；KEY 用 `font-mono`；VALUE 用 `font-mono`；行末删除按钮用 `variant="ghost"` + lucide `Minus` icon（带 `data-icon`）。
  - `+ Add variable` 用 `variant="ghost"` 的 `Button`，左对齐在表下方。
  - 组件本身是 controlled（`rows` prop + `onChange`），不持有内部状态。
  - `envToRows` 至少返回 1 行（若 `env` 为空则返回一个新空 row，让 UI 上永远有可编辑的行）。
  - i18n key：`settings.environment.envVars.addVariable`（"Add variable" / "添加变量"），`settings.environment.envVars.remove`（"Remove" / "删除"）。

- [ ] **Step 4: 运行组件测试确认绿**

  Run: `pnpm vitest run tests/component/environment-vars-table.test.tsx`

---

## Task 8: 环境编辑器重写

**Files:**
- Rewrite: `src/renderer/pages/settings/components/environment-editor.tsx`

**Interfaces:**
- Consumes: Task 6 的 `useLocalEnvironmentsStore.updateProject`；Task 7 的 `EnvironmentVarsTable` 与 helper。
- Produces:
  ```ts
  export interface EnvironmentEditorProps {
    onDirtyChange?: (dirty: boolean) => void;
    project: LocalEnvironmentProject;
  }

  export function EnvironmentEditor(props: EnvironmentEditorProps): JSX.Element;

  // 供 section 复用：暴露一个 imperative revert 方法给外部调用，或者返回一个 ref-like handle。
  // 采用「controlled by key」模式：调用者用 key={project.projectRootPath} 让 remount 触发 revert。
  ```

- [ ] **Step 1: 用如下内容完全替换 `environment-editor.tsx`**

  ```tsx
  import { Button } from "@pier/ui/button.tsx";
  import { FieldSet } from "@pier/ui/field.tsx";
  import { Input } from "@pier/ui/input.tsx";
  import { Textarea } from "@pier/ui/textarea.tsx";
  import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
  import { type ChangeEvent, useEffect, useId, useState } from "react";
  import { useT } from "@/i18n/use-t.ts";
  import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
  import {
    EnvironmentVarsTable,
    createEnvVarRow,
    envRecordsEqual,
    envToRows,
    rowsToEnv,
    type EnvVarRow,
  } from "./environment-vars-table.tsx";

  export interface EnvironmentEditorProps {
    onDirtyChange?: (dirty: boolean) => void;
    project: LocalEnvironmentProject;
  }

  export function EnvironmentEditor({
    onDirtyChange,
    project,
  }: EnvironmentEditorProps): JSX.Element {
    const t = useT();
    const updateProject = useLocalEnvironmentsStore((s) => s.updateProject);
    const editorId = useId();
    const setupId = `${editorId}-env-setup`;
    const cleanupId = `${editorId}-env-cleanup`;

    const [setupCommand, setSetupCommand] = useState(project.setupCommand);
    const [cleanupCommand, setCleanupCommand] = useState(project.cleanupCommand);
    const [envRows, setEnvRows] = useState<EnvVarRow[]>(() =>
      envToRows(project.env)
    );

    const draftEnv = rowsToEnv(envRows);
    const dirty =
      setupCommand !== project.setupCommand ||
      cleanupCommand !== project.cleanupCommand ||
      !envRecordsEqual(draftEnv, project.env);

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    async function save(): Promise<void> {
      if (!dirty) {
        return;
      }
      try {
        await updateProject({
          cleanupCommand,
          env: draftEnv,
          projectRootPath: project.projectRootPath,
          setupCommand,
        });
      } catch (err) {
        console.error("[environment-editor] save failed:", err);
      }
    }

    return (
      <FieldSet>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-medium text-sm" htmlFor={setupId}>
              {t("settings.environment.setupCommand")}
            </label>
            <Textarea
              className="min-h-32 w-full font-mono"
              id={setupId}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setSetupCommand(e.target.value)
              }
              placeholder={t("settings.environment.setupHint")}
              value={setupCommand}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-medium text-sm" htmlFor={cleanupId}>
              {t("settings.environment.cleanupCommand")}
            </label>
            <Textarea
              className="min-h-32 w-full font-mono"
              id={cleanupId}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setCleanupCommand(e.target.value)
              }
              placeholder={t("settings.environment.cleanupHint")}
              value={cleanupCommand}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">
              {t("settings.environment.envVars.title")}
            </span>
            <EnvironmentVarsTable onChange={setEnvRows} rows={envRows} />
          </div>

          <div className="flex justify-end">
            <Button disabled={!dirty} onClick={save} size="sm" type="button">
              {t("settings.environment.save")}
            </Button>
          </div>
        </div>
      </FieldSet>
    );
  }
  ```

  说明：
  - 组件读取初始状态自 `props.project`；`key={project.projectRootPath}` 由 `EnvironmentSection` 提供，切换项目触发 remount 自动 revert 草稿。
  - `onDirtyChange` 用 effect 广播上层，供 `EnvironmentSection` 做脏态守卫。
  - `dirty` 判定不再包含 `name`（项目没有可编辑的 name 字段）。

- [ ] **Step 2: 运行 typecheck 确认 editor 独立编译**

  Run: `pnpm typecheck`

  Expected: 只剩 `environment-section.tsx` 相关错误。

---

## Task 9: 环境 section 重写 + i18n + 集成测试

**Files:**
- Rewrite: `src/renderer/pages/settings/components/environment-section.tsx`
- Modify: `src/renderer/i18n/locales/en/settings.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts`
- Test: `tests/unit/renderer/settings-dialog-environment.test.tsx`

**Interfaces:**
- Consumes: Task 6 store；Task 8 editor；Task 4 preload API。
- Produces:
  - `EnvironmentSection` 组件：顶部 `DropdownMenu` project 切换 + `+ Add folder` 按钮 + 空态 + 单份编辑器。
  - Focus 判定：用户当次会话中在 UI 里选择过的项目 → `activeProjectRootPath` 若在 `projects[]` 命中 → 第一个项目 → 无。存 `useState<Record<string,string> | null>`。
  - 脏态守卫：切换项目、`+ Add folder` 后 focus 新项目、都必须先 `showAppConfirm({ size:"sm", intent:"destructive" })`；用户 Discard 后再执行原动作。
  - 空态：无项目时中央显示 `+ Add folder` primary 按钮。
  - i18n key：新增 `settings.environment.projectLabel`（"Project" / "项目"）、`settings.environment.addFolder`（"Add folder" / "添加文件夹"）、`settings.environment.setupHint`（"Runs when a worktree is created." / "创建 worktree 时执行。"）、`settings.environment.cleanupHint`（"Runs when a worktree is removed." / "移除 worktree 时执行。"）、`settings.environment.envVars.title`（"Variables" / "环境变量"）、`settings.environment.envVars.addVariable`（"Add variable" / "添加变量"）、`settings.environment.envVars.remove`（"Remove" / "删除"）、`settings.environment.discardTitle`（"Discard unsaved changes?" / "放弃未保存的修改吗？"）、`settings.environment.discardBody`（"Changes to \"{{name}}\" will be lost." / "对 \"{{name}}\" 的修改将丢失。"）、`settings.environment.noProject`（"No project added yet." / "还没有添加项目。"）。
  - 删除 i18n key：`settings.environment.createLocalEnvironment` / `create` / `id` / `name` / `noEnvironment` / `selectEnvironment` / `chooseFolder` / `addProject` / `envVars`（改名为 `envVars.title`）等。

- [ ] **Step 1: 重写测试用例**

  完整替换 `tests/unit/renderer/settings-dialog-environment.test.tsx` 的核心 describe，覆盖：

  ```ts
  it("shows empty state when there are no projects", () => {
    setEnvironmentStoreSnapshot({ projects: [], version: 1, worktreeBindings: [] });
    openEnvironmentSettings();
    expect(screen.getByText(/no project added yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeInTheDocument();
  });

  it("focuses the first project when nothing is selected yet", () => {
    setEnvironmentStoreSnapshot({
      projects: [projectFixture("/repo/pier"), projectFixture("/repo/codex")],
      version: 1,
      worktreeBindings: [],
    });
    openEnvironmentSettings();
    expect(screen.getByRole("button", { name: /^project$/i })).toHaveTextContent("pier");
    expect(screen.getByRole("textbox", { name: "Setup command" })).toHaveValue(
      "pnpm setup:worktree"
    );
  });

  it("switches to activeProjectRootPath when it exists in projects", () => {
    setActivePanelProjectRootPath("/repo/codex");
    setEnvironmentStoreSnapshot({
      projects: [projectFixture("/repo/pier"), projectFixture("/repo/codex")],
      version: 1,
      worktreeBindings: [],
    });
    openEnvironmentSettings();
    expect(screen.getByRole("button", { name: /^project$/i })).toHaveTextContent("codex");
  });

  it("ignores activeProjectRootPath that is not in projects", () => {
    setActivePanelProjectRootPath("/repo/unknown");
    setEnvironmentStoreSnapshot({
      projects: [projectFixture("/repo/pier")],
      version: 1,
      worktreeBindings: [],
    });
    openEnvironmentSettings();
    expect(screen.getByRole("button", { name: /^project$/i })).toHaveTextContent("pier");
  });

  it("Add folder button directly calls pickProjectDirectory and adds the returned path", async () => {
    setEnvironmentStoreSnapshot({ projects: [], version: 1, worktreeBindings: [] });
    vi.mocked(window.pier.environments.pickProjectDirectory).mockResolvedValueOnce("/repo/new");
    openEnvironmentSettings();
    await userEvent.click(screen.getByRole("button", { name: /add folder/i }));
    await waitFor(() => {
      expect(window.pier.environments.project.add).toHaveBeenCalledWith({
        projectRootPath: "/repo/new",
      });
    });
  });

  it("Save dispatches flat updateProject payload for the focused project", async () => {
    setEnvironmentStoreSnapshot({
      projects: [projectFixture("/repo/pier")],
      version: 1,
      worktreeBindings: [],
    });
    openEnvironmentSettings();
    const setup = screen.getByRole("textbox", { name: "Setup command" });
    await userEvent.clear(setup);
    await userEvent.type(setup, "pnpm setup:new");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(window.pier.environments.update).toHaveBeenCalledWith({
        cleanupCommand: "pnpm cleanup:worktree",
        env: { NODE_ENV: "development" },
        projectRootPath: "/repo/pier",
        setupCommand: "pnpm setup:new",
      });
    });
  });

  it("prompts before switching project when the editor is dirty", async () => {
    setEnvironmentStoreSnapshot({
      projects: [projectFixture("/repo/pier"), projectFixture("/repo/codex")],
      version: 1,
      worktreeBindings: [],
    });
    openEnvironmentSettings();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Setup command" }),
      "-dirty"
    );
    await openProjectDropdown();
    await userEvent.click(screen.getByRole("menuitem", { name: "codex" }));
    expect(appDialogSpy.showAppConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "destructive", size: "sm" })
    );
  });
  ```

  `projectFixture(rootPath)` helper 返回一份满足新 schema 的 project。断言 `showAppConfirm` 通过 `AppDialogHost` 的 spy 拿到。

- [ ] **Step 2: 运行测试确认红**

  Run: `pnpm vitest run tests/unit/renderer/settings-dialog-environment.test.tsx`

- [ ] **Step 3: 重写 `environment-section.tsx`**

  骨架：

  ```tsx
  import { Button } from "@pier/ui/button.tsx";
  import { Card, CardContent } from "@pier/ui/card.tsx";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "@pier/ui/dropdown-menu.tsx";
  import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
  import { useEffect, useState } from "react";
  import { showAppConfirm } from "@/components/common/app-dialog-host.tsx";
  import { useT } from "@/i18n/use-t.ts";
  import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
  import { useActiveDescriptor } from "@/stores/panel-descriptor.store.ts";
  import { EnvironmentEditor } from "./environment-editor.tsx";

  const PATH_SEPARATOR_RE = /[\\/]/;
  function projectBasename(projectRootPath: string): string {
    return (
      projectRootPath.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
      projectRootPath
    );
  }

  function pickFocused(
    projects: LocalEnvironmentProject[],
    manualSelection: string | null,
    activeProjectRootPath: string | null
  ): LocalEnvironmentProject | null {
    if (manualSelection) {
      const match = projects.find(
        (p) => p.projectRootPath === manualSelection
      );
      if (match) {
        return match;
      }
    }
    if (activeProjectRootPath) {
      const match = projects.find(
        (p) => p.projectRootPath === activeProjectRootPath
      );
      if (match) {
        return match;
      }
    }
    return projects[0] ?? null;
  }

  export function EnvironmentSection(): JSX.Element {
    const t = useT();
    const projects = useLocalEnvironmentsStore((s) => s.projects);
    const addProject = useLocalEnvironmentsStore((s) => s.addProject);
    const activeProjectRootPath =
      useActiveDescriptor()?.context?.projectRootPath ?? null;

    const [manualSelection, setManualSelection] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    const focused = pickFocused(projects, manualSelection, activeProjectRootPath);

    async function guardDirty(): Promise<boolean> {
      if (!dirty || !focused) {
        return true;
      }
      const confirmed = await showAppConfirm({
        body: t("settings.environment.discardBody", {
          name: projectBasename(focused.projectRootPath),
        }),
        intent: "destructive",
        size: "sm",
        title: t("settings.environment.discardTitle"),
      });
      return confirmed;
    }

    async function selectProject(rootPath: string): Promise<void> {
      if (rootPath === focused?.projectRootPath) {
        return;
      }
      if (!(await guardDirty())) {
        return;
      }
      setManualSelection(rootPath);
    }

    async function addFolder(): Promise<void> {
      const dir = await window.pier.environments.pickProjectDirectory();
      if (!dir) {
        return;
      }
      if (!(await guardDirty())) {
        return;
      }
      try {
        await addProject({ projectRootPath: dir });
        setManualSelection(dir);
      } catch (err) {
        console.error("[environment-section] addProject failed:", err);
      }
    }

    useEffect(() => {
      if (
        manualSelection &&
        !projects.some((p) => p.projectRootPath === manualSelection)
      ) {
        setManualSelection(null);
      }
    }, [manualSelection, projects]);

    if (projects.length === 0) {
      return (
        <div className="px-4 pb-4" id="environment">
          <h1 className="mb-4 text-xl">{t("settings.section.environment")}</h1>
          <Card>
            <CardContent>
              <div className="flex flex-col items-center gap-3 py-8">
                <span className="text-muted-foreground text-sm">
                  {t("settings.environment.noProject")}
                </span>
                <Button onClick={addFolder} size="sm" type="button">
                  {t("settings.environment.addFolder")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="px-4 pb-4" id="environment">
        <h1 className="mb-4 text-xl">{t("settings.section.environment")}</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={t("settings.environment.projectLabel")}
                        size="sm"
                        variant="outline"
                      >
                        {focused
                          ? projectBasename(focused.projectRootPath)
                          : t("settings.environment.projectLabel")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72">
                      {projects.map((p) => (
                        <DropdownMenuItem
                          key={p.projectRootPath}
                          onSelect={() => {
                            void selectProject(p.projectRootPath);
                          }}
                        >
                          <div className="flex flex-col">
                            <span className="text-sm">
                              {projectBasename(p.projectRootPath)}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {p.projectRootPath}
                            </span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {focused ? (
                    <span className="text-muted-foreground text-xs">
                      {focused.projectRootPath}
                    </span>
                  ) : null}
                </div>
                <Button
                  onClick={() => {
                    void addFolder();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("settings.environment.addFolder")}
                </Button>
              </div>

              {focused ? (
                <EnvironmentEditor
                  key={focused.projectRootPath}
                  onDirtyChange={setDirty}
                  project={focused}
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 4: 更新 i18n key**

  在 `src/renderer/i18n/locales/en/settings.ts` 与 `src/renderer/i18n/locales/zh-CN/settings.ts` 中：

  - 删除 `environment.createLocalEnvironment` / `create` / `id` / `name` / `noEnvironment` / `selectEnvironment` / `chooseFolder` / `addProject` / `envVars`（改名）等。
  - 新增：

    ```ts
    // en
    environment: {
      addFolder: "Add folder",
      cleanupCommand: "Cleanup command",
      cleanupHint: "Runs when a worktree is removed.",
      discardBody: "Changes to \"{{name}}\" will be lost.",
      discardTitle: "Discard unsaved changes?",
      envVars: {
        addVariable: "Add variable",
        remove: "Remove",
        title: "Variables",
      },
      noProject: "No project added yet.",
      projectLabel: "Project",
      save: "Save",
      setupCommand: "Setup command",
      setupHint: "Runs when a worktree is created.",
    }
    ```

    ```ts
    // zh-CN
    environment: {
      addFolder: "添加文件夹",
      cleanupCommand: "清理命令",
      cleanupHint: "移除 worktree 时执行。",
      discardBody: "对 \"{{name}}\" 的修改将丢失。",
      discardTitle: "放弃未保存的修改？",
      envVars: {
        addVariable: "添加变量",
        remove: "删除",
        title: "环境变量",
      },
      noProject: "还没有添加项目。",
      projectLabel: "项目",
      save: "保存",
      setupCommand: "启动命令",
      setupHint: "创建 worktree 时执行。",
    }
    ```

- [ ] **Step 5: 运行 section 测试确认绿**

  Run: `pnpm vitest run tests/unit/renderer/settings-dialog-environment.test.tsx`

  Expected: 全部通过。

- [ ] **Step 6: 运行 renderer 一侧其他触达点**

  Run: `pnpm vitest run tests/component/environment-vars-table.test.tsx tests/unit/renderer/stores/local-environments-store.test.ts`

  Expected: 全绿。

---

## Task 10: 全量验证

**Files:**
- 所有本次改动的文件。

- [ ] **Step 1: 运行本次触达的目标测试**

  Run:

  ```bash
  pnpm vitest run \
    tests/unit/shared/environment-contract.test.ts \
    tests/unit/main/local-environments-service.test.ts \
    tests/unit/main/local-environment-scripts.test.ts \
    tests/unit/renderer/stores/local-environments-store.test.ts \
    tests/component/environment-vars-table.test.tsx \
    tests/unit/renderer/settings-dialog-environment.test.tsx \
    tests/component/worktree-create-overlay.test.tsx \
    tests/unit/renderer/worktree-operation-actions.test.ts
  ```

  Expected: 全绿。

- [ ] **Step 2: 运行 `pnpm check`**

  Run: `pnpm check`

  Expected: typecheck / lint / depcruise / file-size / unit / component 全通过。若 file-size 报硬上限失败，回到 Task 7-9 拆分 KV 表 helper。

- [ ] **Step 3: 运行 electron 冷启动 e2e**

  Run:

  ```bash
  pnpm build
  pnpm test:e2e tests/e2e/startup-stability.spec.ts
  ```

  Expected: 通过。

- [ ] **Step 4: 检查是否残留旧 schema 关键字**

  Run:

  ```bash
  grep -R "environmentId\|LocalEnvironmentProfile\|selectedEnvironmentId\|environments\[" \
    src tests --include="*.ts" --include="*.tsx"
  ```

  Expected: 无命中（除测试中作为"拒绝"断言的字符串字面量）。

---

## Self-Review

- **Spec 覆盖**：
  - 数据模型铺平 → Task 1 完整替换 schema；Task 2 服务落地；Task 3 命令与生命周期对齐；Task 4 preload / 插件契约收敛；Task 6 renderer store 对齐。
  - 顶部 project 切换器 + 直连 folder picker → Task 9 组件实现。
  - 编辑器脏态守卫 → Task 8 通过 `onDirtyChange` 上报，Task 9 通过 `guardDirty` + `showAppConfirm` 落地。
  - KV 表格 + 每行删除 → Task 7 独立组件 + 测试。
  - i18n 增删 → Task 5 覆盖插件侧、Task 9 覆盖 settings 侧。
  - worktree 生命周期 setup / cleanup 判定与 binding 无条件写入 → Task 3 决策实现。
  - 不做迁移 → 所有 schema 修改都是硬替换，无兼容分支。
- **占位符检查**：无 `TBD` / `TODO` / `实现细节稍后补` 类描述；每个"删除"/"新增"都指名到 key 或方法；接口块给出完整签名。
- **类型一致性**：
  - `EnvironmentUpdateRequest` payload 在 Task 1 / 2 / 6 / 9 中保持一致（`cleanupCommand / env / projectRootPath / setupCommand`）。
  - `LocalEnvironmentWorktreeBindingSnapshot` 在 Task 1 / 2 / 5（worktree-operation-actions 消费方）保持一致（含 `cleanupCommand / setupCommand / env / hasCleanupScript`）。
  - `bindWorktree` 与 `resolveForWorktree` 在 Task 2 定义、Task 3 消费；`resolveProject` 命名统一。
  - `LocalEnvironmentServiceError.reason` 值 `"project_not_found"` 在 Task 2 定义、Task 3 处理错误分支复用。
- **文件大小**：拆分为 `environment-section.tsx` + `environment-editor.tsx` + `environment-vars-table.tsx` 三份，各自远低于软上限；Task 10 Step 2 兜底。
