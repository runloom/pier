# Project Skills Management Implementation Plan

> **SUPERSEDED for product semantics by v9.0.** Do **not** reintroduce
> `approvals.json`, `approval-required`, or “enabled cannot authorize discovery”.
> Normative design: `docs/superpowers/specs/2026-07-14-project-skills-management-design.md` (v9.0).
> This plan remains a historical implementation checklist; treat Goal/Constraints
> below as obsolete wherever they conflict with v9.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (historical v1):** 实现 Pier 项目级技能管理：本地/发现根导入、期望清单、受管相对符号链接投影、崩溃可恢复 apply/repair，以及覆盖终端与一次性 CLI 的 `ManagedAgentLaunchGate`。（v9：**废除**本机内容批准账本；`enabled=true` 即投影。）

**Architecture (v9):** main 拥有全部磁盘权威。项目内 `.pier/skills/{manifest.json,library/**}` 是不可信期望与内容；`{userData}/project-skills/<root-key>/{ownership,operations,staging}` 是本机可信状态（**无** `approvals`）。renderer 只持可丢弃草稿，经 `skills.plan/apply/repair` 收敛。所有消费项目技能的受管智能体进程经 `ManagedAgentLaunchGate.ensureReady` 后再 spawn。

**Tech Stack:** Electron 43 · TypeScript 6 strict · Zod · Vitest 4 · React 19 · Zustand 5 · Biome · 现有 `FilePathTransactionLock` / `file-path-identity` / `FileSafeWriter` 先例

**Spec:** `docs/superpowers/specs/2026-07-14-project-skills-management-design.md`（**v9.0**）

## Global Constraints

- macOS 本地可靠文件系统 only；网络盘/云盘/FUSE 只读诊断，不写
- 不写 `~/.claude` / `~/.codex` / `~/.agents` / `~/.cursor` 用户级技能目录
- 不重定向 `CODEX_HOME` / `CLAUDE_CONFIG_DIR`
- 项目清单 + 库内容 = 不可信；投影删除只靠 `ownership.json`；启用即投影（v9，**不**靠 `approvals.json`）
- Git 清单 `enabled=true` + 有效库内容 **足以**授权发现与受管启动校正
- 清单耐久发布是唯一提交点；提交前失败 = `not-applied`，提交后部分失败 = `degraded`，耐久不明 = `indeterminate`
- 已有清单替换 = 最终检查 + 原子替换 + 发布后复核；**不**声称对不合作外部写者强 CAS
- 投影创建 = `publishNoReplace` 相对目录符号链接；禁止覆盖式投影 rename；禁止递归 `rm` 清库
- 进程内锁必须复用 app-core 注入给 `files` 的同一把 `FilePathTransactionLock`
- 只用 `projectRootPath` / `ProjectRootRef`；不新增 `Project` 注册表或 `projectId`
- 用户文案全部 i18n（`settings.skills.*`）；单行控件 28px；设置 Alert 必须在 `Card` 内
- Choice 一律 `size: "default"`；破坏性 alt 用 `intent: "destructive"`
- 文件尽量聚焦；优先新目录 `src/main/services/project-skills/`，避免反向依赖 file-drafts 业务
- 测试优先：每个 Task 先红测再实现；提交信息 Conventional Commits
- S0 不通过不得进入 S1 业务写入路径

## File Structure

```text
src/shared/contracts/project-skills.ts          # 全部 strict schema / 结果 union / 健康码
src/shared/contracts/commands.ts                # 挂 skills.* 与 agent.launch.continue
src/shared/contracts/permissions.ts             # skills:read / skills:write
src/shared/contracts/events.ts                  # pier://project-skills:invalidated

src/main/services/project-skills/
  paths.ts                                      # userData root-key 路径
  identity.ts                                   # ProjectRootRef / 稳定项目身份
  tree-digest.ts                                # tree-sha256-v1 + riskFingerprint
  fs-adapter.ts                                 # lstat/O_NOFOLLOW/publish/sync/capability probe
  lock.ts                                       # 跨 profile 项目锁 + 复用 FilePathTransactionLock
  store.ts                                      # ownership/approvals/operations/staging 读写
  manifest.ts                                   # 清单 parse/validate/revision
  import-service.ts                             # prepare / prepareFromDiscovery / discard
  plan.ts                                       # draft → planDigest / repairPlan
  apply-service.ts                              # apply 事务状态机
  repair-service.ts                             # repair / ensureReady 校正事务
  recovery.ts                                   # 恢复协调器
  health.ts                                     # doctor / issue 映射 / degradePolicy
  adapters.ts                                   # SkillDiscoveryAdapterRegistry
  service.ts                                    # ProjectSkillsService 门面
  launch-gate.ts                                # ManagedAgentLaunchGate

src/main/app-core/
  project-skills-commands.ts                    # 命令执行
  permissions.ts / command-router.ts / app-core.ts

src/main/ipc/terminal-create-handler.ts         # 接入 launch gate
src/main/services/ai/ai-service.ts              # 一次性 CLI 接入 launch gate

src/renderer/stores/project-skills.store.ts
src/renderer/pages/settings/components/skills-section.tsx
src/renderer/pages/settings/components/skills-*.tsx  # list/detail/import/change-bar 可拆
src/renderer/pages/settings/data/appearance-nav.ts
src/renderer/pages/settings/settings-dialog.tsx
src/renderer/i18n/locales/**/settings.json

tests/unit/main/project-skills-*.test.ts
tests/unit/renderer/settings-dialog-skills*.test.tsx
tests/unit/renderer/project-skills-store.test.ts
tests/component/...（按现有 component 惯例）
scripts/project-skills/                              # S0 探测脚本与证据
docs/superpowers/spikes/2026-07-19-project-skills-s0.md
```

---

### Task 1: S0 官方事实与探测证据基线

**Files:**
- Create: `scripts/project-skills/probe-agent-skills.mjs`
- Create: `docs/superpowers/spikes/2026-07-19-project-skills-s0.md`
- Create: `tests/unit/main/project-skills-s0-evidence.test.ts`

**Interfaces:**
- Produces: 固化 Codex/Claude/Cursor/OpenCode 发现路径、symlink 行为、重复发现语义的可复查证据文件
- Produces: probe 脚本可在本机打印版本与路径探测结果（允许 skip 未安装 agent）

- [ ] **Step 1: 写证据文件存在性测试**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project skills S0 evidence", () => {
  it("records official discovery facts and probe entrypoint", async () => {
    const spike = await readFile(
      join(process.cwd(), "docs/superpowers/spikes/2026-07-19-project-skills-s0.md"),
      "utf8"
    );
    expect(spike).toContain("Codex");
    expect(spike).toContain(".agents/skills");
    expect(spike).toContain("Claude Code");
    expect(spike).toContain(".claude/skills");
    expect(spike).toContain("Cursor");
    expect(spike).toContain("OpenCode");
    expect(spike).toContain("symlink");
    expect(spike).toContain("duplicate-discovery");
    expect(spike).toContain("ManagedAgentLaunchGate");

    const probe = await readFile(
      join(process.cwd(), "scripts/project-skills/probe-agent-skills.mjs"),
      "utf8"
    );
    expect(probe).toContain("codex");
    expect(probe).toContain("claude");
  });
});
```

- [ ] **Step 2: 实现 spike 文档 + probe 脚本**
  - 文档逐条引用 design §2.1，并写明“符号链接最低版本以本机探测为准”
  - 脚本探测 `which`/版本命令；对临时 fixture 创建相对 symlink 后记录可发现性假设（不要求 CI 安装全部 agent）
- [ ] **Step 3: 跑测**

Run: `pnpm exec vitest run tests/unit/main/project-skills-s0-evidence.test.ts`

- [ ] **Step 4: Commit**

```bash
git add scripts/project-skills docs/superpowers/spikes/2026-07-19-project-skills-s0.md tests/unit/main/project-skills-s0-evidence.test.ts
git commit -m "$(cat <<'EOF'
docs(skills): capture S0 agent skills discovery evidence

EOF
)"
```

---

### Task 2: S0 文件系统原语证明（no-replace / 保守 replace / sync）

**Files:**
- Create: `src/main/services/project-skills/fs-adapter.ts`
- Create: `tests/unit/main/project-skills-fs-adapter.test.ts`
- Create: 在 S0 spike 追加 “Filesystem primitives” 结论段

**Interfaces:**

```ts
export type FsObjectIdentity = {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  birthtimeNs?: bigint;
};

export type PublishNoReplaceResult =
  | { status: "created"; identity: FsObjectIdentity }
  | { status: "conflict"; reason: "target-exists" | "parent-invalid" };

export type PublishReplaceReviewResult =
  | { status: "replaced"; identity: FsObjectIdentity; postCheck: "matched" }
  | { status: "conflict"; reason: "target-changed" | "target-missing" }
  | { status: "indeterminate"; reason: "post-check-diverged" | "sync-unknown" };

export interface ProjectSkillsFileSystemAdapter {
  probeCapabilities(rootPath: string): Promise<{
    writable: boolean;
    supportsNoFollow: boolean;
    supportsDirSync: boolean;
    kind: "local-reliable" | "unsupported";
  }>;
  lstatIdentity(path: string): Promise<FsObjectIdentity>;
  publishSymlinkNoReplace(args: {
    linkPath: string;
    relativeTarget: string; // e.g. ../../.pier/skills/library/id
  }): Promise<PublishNoReplaceResult>;
  publishFileReplaceIfUnchanged(args: {
    path: string;
    expected: { kind: "absent" } | { kind: "present"; identity: FsObjectIdentity; digest: string };
    bytes: Buffer;
    digestOf: (bytes: Buffer) => string;
  }): Promise<PublishReplaceReviewResult>;
  syncDirectory(path: string): Promise<void>;
}
```

实现要点：
- symlink 创建：同父目录临时名 + `RENAME_EXCL`/`link` 语义等价的 no-clobber；保留对象身份
- 文件替换：final check → atomic rename → parent sync → re-read identity/digest；偏离返回 `indeterminate`
- **禁止**在文档/注释里写“强 CAS 已证明”
- 复用/对齐 `file-path-identity.ts` 的 root escape 检查思想，但 skills 适配器保持独立，避免污染 file editor 语义

- [ ] **Step 1: 红测**
  - no-replace 在目标已存在时 conflict，且既有对象 identity 不变
  - 首次创建 symlink 后 identity 稳定，readlink 为相对目标
  - replace：外部在 final check 后改写目标时，不得静默当成 matched（允许 conflict 或 indeterminate，但必须可测）
  - parent sync 失败映射为 unknown/indeterminate
- [ ] **Step 2: 实现 `fs-adapter.ts`**
- [ ] **Step 3: 跑测**

Run: `pnpm exec vitest run tests/unit/main/project-skills-fs-adapter.test.ts`

- [ ] **Step 4: 把结论写入 spike（通过/收窄）并 commit**

```bash
git add src/main/services/project-skills/fs-adapter.ts tests/unit/main/project-skills-fs-adapter.test.ts docs/superpowers/spikes/2026-07-19-project-skills-s0.md
git commit -m "$(cat <<'EOF'
feat(skills): prove macOS project-skills filesystem primitives

EOF
)"
```

---

### Task 3: 共享契约与权限（schemas / capabilities / commands）

**Files:**
- Create: `src/shared/contracts/project-skills.ts`
- Modify: `src/shared/contracts/permissions.ts`
- Modify: `src/shared/contracts/commands.ts`
- Modify: `src/shared/contracts/events.ts`（若事件联合在此）
- Create: `tests/unit/main/project-skills-contract.test.ts`
- Modify: 任何因 `Record<PierCommand["type"], …>` 全量 key 强制而必须同步的 metadata 文件

**Interfaces（最小冻结，名称可在实现时微调但信息不可缺）：**

```ts
// project-skills.ts
export const skillIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64);
export const contentDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const projectSkillsManifestSchema = z.object({
  version: z.literal(1),
  delivery: z.object({ claude: z.boolean() }).strict(),
  skills: z.array(z.object({
    id: skillIdSchema,
    enabled: z.boolean(),
    contentDigest: contentDigestSchema,
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("local-import") }).strict(),
      z.object({ type: z.literal("project-discovery-import") }).strict(),
      z.object({ type: z.literal("git-declared") }).strict(),
    ]),
  }).strict()),
}).strict();

export const projectSkillsIssueCodeSchema = z.enum([
  "disabled","adapter-disabled","agent-not-installed","not-applicable",
  "new-session-recommended","git-visible-projection","git-tracked-projection","cleanup-pending",
  "projection-missing","projection-stale","recovery-pending","approval-required",
  "missing-source","invalid-skill","library-drift","content-conflict",
  "unmanaged-conflict","managed-target-modified","project-identity-changed",
  "ledger-corrupt","approval-ledger-corrupt","recovery-record-corrupt","recovery-blocked","durability-unknown",
  "filesystem-unsupported","permission-changed","insufficient-space","operation-busy",
  "duplicate-discovery","agent-version-unsupported","unknown-agent-behavior",
]);

export const degradePolicySchema = z.enum([
  "allowed",
  "requires-content-risk-confirmation",
  "denied",
]);

export const applyResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("converged"), /* operationId, revisions, snapshot */ }).strict(),
  z.object({ status: z.literal("degraded"), /* ... */ }).strict(),
  z.object({ status: z.literal("indeterminate"), /* no fake snapshot */ }).strict(),
]);
```

Capabilities：
```ts
// permissions.ts 增加
"skills:read",
"skills:write",
// desktop-renderer: 两者都有
// cli-local: 仅 skills:read
```

Commands（全部进 `pierCommandSchema` + `COMMAND_METADATA`）：
- `skills.projects.snapshot`
- `skills.project.pick`
- `skills.snapshot`
- `skills.import.prepare`
- `skills.import.prepareFromDiscovery`
- `skills.import.discard`
- `skills.plan`
- `skills.apply`
- `skills.repair.plan`
- `skills.repair`
- `skills.doctor`
- `skills.operation.status`
- `agent.launch.continue`

- [ ] **Step 1: 契约单测**
  - 非法 id / 重复 id / 未知字段 reject
  - `degradePolicy` 与 issue code 穷尽
  - apply result union 互斥
- [ ] **Step 2: 实现 schema + 权限 + 命令注册（handler 可先 throw not-implemented，但 typecheck 必须过）**
- [ ] **Step 3: 跑测 + typecheck 相关包**

Run:
```bash
pnpm exec vitest run tests/unit/main/project-skills-contract.test.ts
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(skills): add project-skills contracts and capabilities

EOF
)"
```

---

### Task 4: 树摘要、风险指纹、项目身份

**Files:**
- Create: `src/main/services/project-skills/tree-digest.ts`
- Create: `src/main/services/project-skills/identity.ts`
- Create: `src/main/services/project-skills/paths.ts`
- Create: `tests/unit/main/project-skills-tree-digest.test.ts`
- Create: `tests/unit/main/project-skills-project-identity.test.ts`

**Interfaces:**

```ts
export function computeTreeSha256V1(rootDir: string): Promise<string>; // sha256:...
export function computeRiskFingerprint(args: {
  treeFiles: readonly { relativePath: string; executable: boolean; bytes?: Buffer }[];
  frontmatter: Record<string, unknown>;
}): string;

export type StableProjectIdentity = {
  realPath: string;
  volumeId: string;
  directoryIdentity: string; // dev/ino(/birth) stable key
};

export type ProjectRootRef = {
  realPath: string;
  identity: StableProjectIdentity;
  token?: string; // main-issued
};

export function createProjectSkillsPaths(userData: string): {
  rootKeyFor(identity: StableProjectIdentity): string;
  projectDir(rootKey: string): string;
  ownershipPath(rootKey: string): string;
  approvalsPath(rootKey: string): string;
  operationsDir(rootKey: string): string;
  stagingDir(rootKey: string): string;
};
```

规则落地：
- tree digest：路径字节序、类型、长度、内容、可执行位；拒绝 symlink/hardlink/special/case-fold/unicode-normalize 冲突
- 同卷 rename：旧 path 不可用且 identity 唯一匹配才允许 rekey
- clone/rebuild/path reuse：新项目，不继承 ownership/approvals

- [ ] **Step 1: 红测（稳定摘要、拒绝 symlink、identity rekey/no-inherit）**
- [ ] **Step 2: 实现**
- [ ] **Step 3: 跑测**

Run: `pnpm exec vitest run tests/unit/main/project-skills-tree-digest.test.ts tests/unit/main/project-skills-project-identity.test.ts`

- [ ] **Step 4: Commit**

---

### Task 5: 本机 store（ownership / approvals / operations / staging）+ 跨进程锁

**Files:**
- Create: `src/main/services/project-skills/store.ts`
- Create: `src/main/services/project-skills/lock.ts`
- Create: `tests/unit/main/project-skills-store.test.ts`
- Create: `tests/unit/main/project-skills-lock.test.ts`

**Interfaces:**

```ts
export type OwnershipRecord = {
  schemaVersion: 1;
  generation: number;
  projectIdentity: StableProjectIdentity;
  targets: Array<{
    relativePath: string; // .agents/skills/id
    skillId: string;
    expectedRelativeLinkTarget: string;
    objectIdentity: FsObjectIdentity;
    createdByOperationId: string;
    createdAt: number;
  }>;
};

export type ApprovalsFile = {
  schemaVersion: 1;
  generation: number;
  projectIdentity: StableProjectIdentity;
  approvals: ApprovedSkillContent[];
};

export type OperationRecord =
  | { kind: "in-flight"; phase: string; /* recovery fields */ }
  | { kind: "terminal"; status: "converged"|"degraded"|"not-applied"|"superseded"|"recovery-blocked"; requestDigest: string; result: unknown };

export interface ProjectSkillsStore {
  readOwnership(rootKey: string): Promise<OwnershipRecord | null>;
  commitOwnership(rootKey: string, expectedGen: number, next: OwnershipRecord): Promise<void>;
  readApprovals(rootKey: string): Promise<ApprovalsFile | null>;
  commitApprovals(rootKey: string, expectedGen: number, next: ApprovalsFile): Promise<void>;
  readOperation(rootKey: string, operationId: string): Promise<OperationRecord | null>;
  writeOperation(...): Promise<void>;
  // staging candidate state machine AVAILABLE→CLAIMED→CONSUMED/RELEASED
}
```

锁：
```ts
export function createProjectSkillsLock(args: {
  transactionLock: FilePathTransactionLock; // REQUIRED injected singleton
  sharedLockRoot: string; // per-user, not per profile userData
}): {
  runExclusive<T>(identity: StableProjectIdentity, paths: string[], fn: () => Promise<T>): Promise<T>;
};
```

- generation CAS 失败要 typed error
- corrupt isolation：PREPARED tombstone → move no-replace → QUARANTINED
- 跨 profile：共享锁串行化，但不共享 approvals/ownership 内容

- [ ] **Step 1: 红测**
- [ ] **Step 2: 实现**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 6: 导入服务（本地选择 + 发现根只读复制）

**Files:**
- Create: `src/main/services/project-skills/import-service.ts`
- Create: `tests/unit/main/project-skills-import.test.ts`

**Interfaces:**

```ts
prepareLocalImport(projectRef): Promise<ImportCandidateView | null> // native dialog cancel → null
prepareFromDiscovery(projectRef, relativeSource): Promise<ImportCandidateView>
discardImport(projectRef, token): Promise<void> // idempotent
```

硬规则：
- 普通 prepare：源不得在 `.pier/skills`、staging、目标 library 同 inode
- prepareFromDiscovery：仅真实目录、非 symlink、非 managed projection；只复制
- 双遍历一致才发布候选；`source-changed` 销毁精确暂存
- 限制：2000 files / depth 32 / 16MiB file / 128MiB total / path 1024
- YAML frontmatter 安全解析；算 tree digest + riskFingerprint
- token：高熵、30min、绑定 webContents/client/project/digest

- [ ] **Step 1: 红测（symlink 拒绝、发现根复制、双遍历、quota、discard 幂等）**
- [ ] **Step 2: 实现**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 7: Plan / health / adapters（只读收敛计算）

**Files:**
- Create: `src/main/services/project-skills/adapters.ts`
- Create: `src/main/services/project-skills/health.ts`
- Create: `src/main/services/project-skills/plan.ts`
- Create: `tests/unit/main/project-skills-adapters.test.ts`
- Create: `tests/unit/main/project-skills-health.test.ts`
- Create: `tests/unit/main/project-skills-plan.test.ts`

**Interfaces:**

```ts
export interface SkillDiscoveryAdapter {
  agentKind: AgentKind | "opencode" | "cursor" | ...;
  discoveryRoots: readonly string[]; // relative
  consumesProjectSkills: boolean;
  duplicatePolicy: "report";
  sessionRefresh: "new-session-recommended" | "live-watch-docs-only";
}

plan(projectRef, observedRevision, draft): Promise<ProjectSkillsPlan>
doctor(projectRef): Promise<SnapshotHealth>
```

`planDigest` 输入必须包含：规范化草稿、observedRevision、有序目标操作、Git 五态、批准前置、确认要求。  
健康码 → severity/blockingScopes/degradePolicy 按 design §5.1 表固定。  
`approval-required`：清单 enabled 但本机无匹配批准。  
OpenCode **与 Cursor** 在 Claude 适配开启时都要能报 `duplicate-discovery`。

- [ ] **Step 1: 红测**
- [ ] **Step 2: 实现**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 8: Apply 事务状态机 + 库清理对象身份

**Files:**
- Create: `src/main/services/project-skills/apply-service.ts`
- Create: `src/main/services/project-skills/recovery.ts`
- Create: `tests/unit/main/project-skills-apply.test.ts`
- Create: `tests/unit/main/project-skills-cleanup.test.ts`
- Create: `tests/unit/main/project-skills-recovery.test.ts`

**状态机：**
```text
PREPARED → CONTENT_PUBLISHED → MANIFEST_COMMITTED → APPROVALS_COMMITTED
  → RECONCILING_TARGETS → OWNERSHIP_COMMITTED → FINALIZED
```

关键不变量：
- 第一次项目写入前写 recovery log + sync
- claim import candidates before publish
- 新启用内容在 APPROVALS_COMMITTED 写入批准
- 投影：no-replace symlink only
- 删除投影：ownership + identity + link target 全匹配
- 库清理：逐文件/目录 identity；最后 `rmdir`；新文件 → `cleanup-pending`/`degraded`
- 同 operationId+requestDigest 幂等返回终态
- Git 删除确认：确认耐久写入前 plan 可变；写入后按精确对象重放

- [ ] **Step 1: 红测（提交前失败 not-applied、提交后 degraded、幂等、清理不 rm 新文件、崩溃恢复）**
- [ ] **Step 2: 实现 apply + recovery**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 9: Repair / ensureReady + ProjectSkillsService 门面 + 命令路由

**Files:**
- Create: `src/main/services/project-skills/repair-service.ts`
- Create: `src/main/services/project-skills/service.ts`
- Create: `src/main/app-core/project-skills-commands.ts`
- Modify: `src/main/app-core/app-core.ts`
- Modify: `src/main/app-core/command-router.ts`
- Modify: `src/main/app-core/command-router-services.ts`（若有）
- Create: `tests/unit/main/project-skills-service.test.ts`
- Create: `tests/unit/main/project-skills-command-router.test.ts`
- Create: `tests/unit/main/project-skills-reconcile.test.ts`

**Interfaces:**

```ts
export interface ProjectSkillsService {
  projectsSnapshot(): Promise<ProjectSkillsProjectSummary[]>;
  pickProject(): Promise<ProjectRootRef | null>;
  snapshot(ref): Promise<ProjectSkillsSnapshot>;
  plan(...): Promise<ProjectSkillsPlan>;
  apply(...): Promise<ApplyResult>;
  repairPlan(...): Promise<ProjectSkillsRepairPlan>;
  repair(...): Promise<ReconcileResult>;
  doctor(...): Promise<...>;
  operationStatus(...): Promise<OperationStatus>;
  ensureReady(ref, agentId, launchAttemptId): Promise<EnsureReadyResult>;
}
```

ensureReady：
- 不改清单
- 只做无需新确认且已批准内容的安全校正
- 未批准 / corrupt / unmanaged → 结构化阻断，不自动批准

app-core：
- `createProjectSkillsService({ transactionLock: files 同锁, userData, dialogs, ... })`
- broadcast `pier://project-skills:invalidated`

- [ ] **Step 1: 红测（清单三态、read 无写副作用、命令 schema/capability）**
- [ ] **Step 2: 接线实现**
- [ ] **Step 3: 跑测**

Run:
```bash
pnpm exec vitest run tests/unit/main/project-skills-service.test.ts tests/unit/main/project-skills-command-router.test.ts tests/unit/main/project-skills-reconcile.test.ts
```

- [ ] **Step 4: Commit**

---

### Task 10: ManagedAgentLaunchGate（终端 + ai.generateText）

**Files:**
- Create: `src/main/services/project-skills/launch-gate.ts`
- Modify: `src/main/ipc/terminal-create-handler.ts`
- Modify: `src/main/ipc/agents.ts` / launch registry（如需保存 attempt）
- Modify: `src/main/services/ai/ai-service.ts`
- Modify: `src/main/app-core/permissions.ts`（`agent.launch.continue`）
- Create: `tests/unit/main/project-skills-launch.test.ts`
- Create: `tests/unit/main/ai-service-skills-gate.test.ts`
- Create: `tests/unit/main/project-skills-launch-architecture.test.ts`（静态枚举入口）

**Interfaces:**

```ts
export type LaunchGateResult =
  | { status: "ready"; launchAttemptId: string }
  | {
      status: "blocked";
      launchAttemptId: string;
      challenge: string;
      issueSummary: string[];
      degradePolicySummary: "allowed"|"requires-content-risk-confirmation"|"denied";
      expiresAt: number;
    };

continueLaunch(args: {
  launchAttemptId: string;
  challenge: string;
  decision: "open-settings" | "degrade" | "cancel";
  acknowledgements?: Acknowledgement[];
}): Promise<LaunchContinueResult>;
```

接线规则：
1. 终端：在 `addon.createTerminal(...)` **之前**调用 gate；项目身份从 main launch record / panel session / main resolve 得到，**不信任** renderer `createArgs.context` 作为最终权威
2. AI one-shot：在 `runOneShot` 前 gate；blocked 返回 structured unavailable，禁止静默
3. degrade：`denied` 拒绝；`requires-content-risk-confirmation` 必须 acknowledgement；`SPAWN_INTENT` 先耐久再 spawn，不自动重放
4. 架构测试：grep/枚举 `resolveAgentLaunch` / `runOneShot` / `terminal.open` launch 路径都经 gate

- [ ] **Step 1: 红测（阻断、降级策略、一次性 CLI、重放拒绝、架构枚举）**
- [ ] **Step 2: 实现并接线**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 11: Preload / renderer store / i18n 基础

**Files:**
- Modify: preload 命令代理（现有 pier command bridge 模式）
- Create: `src/renderer/stores/project-skills.store.ts`
- Create: `tests/unit/renderer/project-skills-store.test.ts`
- Modify: `src/renderer/i18n/locales/en/settings.json`
- Modify: `src/renderer/i18n/locales/zh/settings.json`（或项目既有 locale 布局）

**Store 职责：**
- 保存 `observedRevision`、draft、request generations、operationId
- 分命令响应接收规则（design §7.5）
- stale draft 时禁用 apply，提示 reload
- 订阅 `project-skills:invalidated`

Draft 形状：
```ts
type SkillsDraft = {
  deliveryClaude: boolean;
  enabled: Record<string, boolean>; // existing ids only
  addImportTokens: string[];
  removeSkillIds: string[]; // mark only; confirm at apply
};
```

- [ ] **Step 1: store 单测（迟到 plan 丢弃、apply 按 operationId、invalidate）**
- [ ] **Step 2: 实现 store + i18n keys（至少 section 标题/空态/apply/repair/launch）**
- [ ] **Step 3: 跑测**
- [ ] **Step 4: Commit**

---

### Task 12: Settings UI — 导航 + 项目列表/详情/导入/操作栏

**Files:**
- Modify: `src/renderer/pages/settings/data/appearance-nav.ts`（environment 后插入 `skills`）
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`
- Modify: `src/renderer/stores/settings-dialog.store.ts`（narrow leave guard：`canLeave`/`leave`/`requestSectionChange`/`requestSettingsClose`）
- Create: `src/renderer/pages/settings/components/skills-section.tsx`（可拆子文件）
- Create: `tests/unit/renderer/settings-dialog-skills.test.tsx`
- Create: `tests/component/skills-section.test.tsx`（若 component 测试更合适）
- 确保设置 Alert 布局能过 `settings-section-alert-layout-governance.test.ts`

UI 必须实现：
- 三种页内模式：列表 / 详情 / 导入检查
- Card 内 Alert
- 固定操作栏；更改检查区承载 confirmationRequirements
- 删除 = 标记待删 + 撤销；**应用时**统一破坏性确认
- Choice leave guard：`size: "default"`, `intent: "destructive"`, 横排 alt|cancel|confirm
- 导入默认停用；发现根导入入口文案说明只读复制
- 启动阻断 UI helper（可供 terminal launch 调用）：按 degradePolicy 显隐“仍然启动”

- [ ] **Step 1: 组件/store 红测（模式切换、leave guard、Alert in Card、确认时机）**
- [ ] **Step 2: 实现 UI**
- [ ] **Step 3: 跑测 + 治理测**

Run:
```bash
pnpm exec vitest run tests/unit/renderer/settings-dialog-skills.test.tsx tests/unit/renderer/settings-section-alert-layout-governance.test.ts tests/unit/renderer/app-dialog-governance.test.ts tests/unit/renderer/user-copy-governance.test.ts
```

- [ ] **Step 4: Commit**

---

### Task 13: 端到端安全与并发加固测试集

**Files:**
- Create: `tests/unit/main/project-skills-security.test.ts`
- Create: `tests/unit/main/project-skills-approval.test.ts`
- Extend: apply/recovery/launch 测试至 design §10 关键行

覆盖至少：
- 非托管不覆盖/不删除
- 改写 symlink 或重建同名链接保留
- 未批准 Git 清单不投影、不 ensureReady 放行
- 新摘要/新 riskFingerprint 重新批准
- 只读 capability 无写副作用
- operation tombstone 不重执行
- 跨 profile 不继承 ownership/approvals（可用临时目录模拟双 store）

- [ ] **Step 1: 写齐红测并实现缺口**
- [ ] **Step 2: 跑全项目 skills 相关单测**

Run:
```bash
pnpm exec vitest run tests/unit/main/project-skills- tests/unit/renderer/project-skills- tests/unit/renderer/settings-dialog-skills
pnpm typecheck
```

- [ ] **Step 3: Commit**

---

### Task 14: S0/S3 收口清单与人工验证脚本

**Files:**
- Update: `docs/superpowers/spikes/2026-07-19-project-skills-s0.md`（勾选完成证据）
- Create: `docs/superpowers/spikes/2026-07-19-project-skills-manual-qa.md`

人工/半自动检查表：
1. 本地导入 → 停用添加 → 启用应用 → `.agents/skills/<id>` 为相对 symlink
2. 禁用应用后 symlink 按 ownership 删除
3. 新 clone fixture：清单 enabled 但无 approvals → 启动阻断 `approval-required`
4. 批准后 ensureReady 创建投影
5. Claude 适配开：OpenCode/Cursor 健康出现 duplicate-discovery（有安装时）
6. `ai.generateText` 在未就绪项目返回结构化失败
7. 用户级 skills 目录无新增
8. 设置窄宽 leave guard / Alert in Card / 无嵌套 button

- [ ] **Step 1: 写 manual QA 文档**
- [ ] **Step 2: 在 dev 环境按表执行并记录结果**
- [ ] **Step 3: Commit 文档**

---

## Spec Coverage Checklist

| Design area | Tasks |
| --- | --- |
| §1 目标/信任边界 | 3,5,8,10 |
| §2 官方事实/范围 | 1,7,14 |
| §3 状态/批准/ownership | 3–5,8 |
| §4 命令/事务/Git 确认边界 | 3,7–9 |
| §5 健康/degrade/launch gate | 7,10,12 |
| §6 安全导入/清理/FS 承诺 | 2,6,8,13 |
| §7 Settings UI/Git 文案 | 11,12 |
| §8 反模式 | 全程约束 + 13 |
| §9 S0–S3 | 1–2=S0; 3–9=S1; 11–12=S2; 10+14=S3 |
| §10 验收矩阵 | 13 汇总，各 task 分测 |

## Execution Notes

- **S0 gate:** Task 1–2 失败则停止，不得开始 apply/UI。
- **Lock injection:** `createFileService` 与 `createProjectSkillsService` 必须共享同一 `FilePathTransactionLock` 实例；在 `app-core.ts` 先创建 lock 再注入两边。
- **Launch gate placement:** 优先抽 `ManagedAgentLaunchGate` 纯服务，terminal/AI 只调用，避免在 handler 复制策略。
- **Windows/Linux:** 不实现伪分支；`probeCapabilities` 非 darwin 或 unsupported fs 直接 `filesystem-unsupported`。
- **Commit 节奏:** 每 Task 一次 commit；不要 `git add .`。

