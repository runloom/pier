# Agent 注意力设置与状态准确性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Checkbox steps. Do **not** expand into completion notifications, sounds, terminal bell, history, Canvas, or plugin `agents.list/subscribe`.

**Goal:** 落地修订后的 [设计](../specs/2026-07-16-agent-attention-settings-and-status-accuracy-design.md)：可持久化 Attention 策略（含 `PATCHABLE_KEYS`）、可恢复权限探针、设置「通知」分区、触发矩阵、B 档映射收敛、Top 四家真实证据链门禁。

**Architecture:**

```text
preferences.update({ agentAttention })
  → preferences-service PATCHABLE_KEYS（必须含 agentAttention）
  → disk + preferences.changed
  → main Attention settings 同步缓存
  → observe(FA): 触发矩阵 → enabled/suppress/cooldown → show
system-notification: stickyDenied + forceProbe(test) → permission status 广播
```

**Tech Stack:** Electron IPC + zod preferences + 现有 Attention / system-notification + 设置 SwitchRow/SelectRow + vitest。

**Spec:** 修订版 2026-07-16 design（Codex 审查 P0/P1 已吸收）  
**Branch:** `feat/agent-attention-settings-status-accuracy`

## Global Constraints

- FA 唯一语义；Index 不自算 status；禁 OCR waiting。
- 默认：`enabled=true`，`enableErrorAttention=false`，`suppressWhenFocused=true`，`cooldownMs=180_000`。
- **嵌套 patch 整对象替换**；白名单遗漏 = 功能不存在。
- 保存/测试失败必须用户可见；禁止 silent `catch`。
- 触发 = **非触发集 → 触发集**（非 `previous !== next`）。
- B 档未审完不得宣称状态准确性完成。
- Git：显式 stage；commit 前展示 diff+message 等用户确认。

---

## 文件地图

| 路径 | 职责 |
| --- | --- |
| `src/shared/contracts/agent-attention.ts` | settings schema、默认值、cooldown 枚举、permission status 类型 |
| `src/shared/contracts/preferences.ts` | `agentAttention` 字段 |
| `src/main/state/preferences.ts` | DEFAULTS |
| **`src/main/services/preferences-service.ts`** | **`PATCHABLE_KEYS` + `agentAttention`** |
| `src/main/services/agent-attention/attention-service.ts` | 触发矩阵 + enabled/suppress + 同步 settings |
| `src/main/ipc/agent-attention.ts` | 缓存 settings；订阅 preferences.changed |
| `src/main/services/system-notification.ts` | sticky + forceProbe + getPermissionSnapshot |
| `src/shared/ipc-channels.ts` + preload | permission/test/openSettings |
| `src/renderer/stores/agent-attention-preferences.store.ts` | 整对象 update + 失败可见 |
| `src/renderer/pages/settings/components/notifications-section.tsx` | UI |
| integrations B 档文件 | 映射收敛 |
| tests | 见各 Task |

---

## Phase map

| Phase | Tasks |
| --- | --- |
| 契约+白名单持久化 | 1 |
| Attention 矩阵+设置 | 2 |
| 探针 forceProbe | 3 |
| 设置 UI + store | 4–5 |
| B 收敛 + S1–S3 门禁 | 6 |
| 验收 | 7 |

---

### Task 1: 契约 + preferences 字段 + **PATCHABLE_KEYS**

**Files:**

- Modify: `src/shared/contracts/agent-attention.ts`
- Modify: `src/shared/contracts/preferences.ts`
- Modify: `src/main/state/preferences.ts`
- Modify: **`src/main/services/preferences-service.ts`**（`PATCHABLE_KEYS` 增加 `"agentAttention"`）
- Test: `tests/unit/shared/agent-attention-settings.test.ts`
- Test: `tests/unit/main/preferences-service-agent-attention.test.ts`（新建；或扩展现有 preferences-service 测）

**Interfaces:**

```ts
// agent-attention.ts — full AgentAttentionSettings + zod + defaults
// preferences: agentAttention: agentAttentionSettingsSchema.default(...)
```

**Produces for later tasks:** 持久化后的 `ProjectPreferences.agentAttention`；`preferences.changed` 含该 key。

- [ ] **Step 1: 失败测 — schema 默认 + 非法 cooldown**

```ts
// tests/unit/shared/agent-attention-settings.test.ts
// 见设计 §4.1 默认值；cooldown 123 应 fail
```

- [ ] **Step 2: 失败测 — service 白名单（关键 P0）**

```ts
import { createPreferencesService } from "@main/services/preferences-service.ts";
// mock updatePreferencesState / read
// update({ agentAttention: { enabled: false, enableErrorAttention: false, suppressWhenFocused: true, cooldownMs: 60_000 } })
// expect underlying mutate 收到 agentAttention
// expect changedKeys 包含 "agentAttention"
// 对照：若忘记 PATCHABLE_KEYS，normalizedPatch 为空 → 本测必须红
```

- [ ] **Step 3: 实现契约 + DEFAULTS + PATCHABLE_KEYS**

- [ ] **Step 4:**

```bash
pnpm test:unit -- agent-attention-settings
pnpm test:unit -- preferences-service
```

Expected: PASS

- [ ] **Step 5: 提交（用户确认后）** `feat(attention): add agentAttention prefs and patch whitelist`

---

### Task 2: Attention 触发矩阵 + 完整 settings 消费 + 同步缓存

**Files:**

- Modify: `src/main/services/agent-attention/attention-service.ts`
- Modify: `src/main/ipc/agent-attention.ts`
- Modify: `tests/unit/main/agent-attention.test.ts`

**触发矩阵实现（替换 `previous !== next`）：**

```ts
function inTriggerSet(
  status: ActivityStatus | undefined,
  settings: AgentAttentionSettings
): boolean {
  if (status === "waiting") return true;
  return settings.enableErrorAttention && status === "error";
}

function enteredAttention(
  previous: ActivityStatus | undefined,
  next: ActivityStatus | undefined,
  settings: AgentAttentionSettings
): boolean {
  return !inTriggerSet(previous, settings) && inTriggerSet(next, settings);
}
```

**settings 缓存（ipc）：**

```ts
let cached = DEFAULT_AGENT_ATTENTION_SETTINGS;
// boot: readPreferences().then(p => { cached = p.agentAttention })
// on preferences.changed / eventBus: if changedKeys includes agentAttention → cached = snapshot.agentAttention
// createAgentAttentionService({ settings: () => cached, ... })
```

`settings()` 保持 **同步** `() => AgentAttentionSettings`。

- [ ] **Step 1: 单测矩阵**

```ts
it("does not re-notify waiting→error when both in trigger set", ...);
it("does not re-notify error→waiting when both in trigger set", ...);
it("notifies ∅→waiting", ...);
it("notifies ∅→error only if enableErrorAttention", ...);
it("skips when enabled false", ...);
it("notifies when focused if suppressWhenFocused false", ...);
// 保留 cooldown / shown:false 不记冷却
```

- [ ] **Step 2–4: 红 → 实现 → 绿**

```bash
pnpm test:unit -- agent-attention
```

- [ ] **Step 5: 提交** `fix(attention): enter trigger-set semantics and live settings cache`

---

### Task 3: 权限探针 + forceProbe 测试通知 + 打开系统设置

**Files:**

- Modify: `src/main/services/system-notification.ts`
- Modify: `src/shared/contracts/notification.ts`（probe 快照类型优先放此，避免污染 agent domain）
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/notification.ts` / host 注册
- Modify: preload + `window.pier` 类型
- Test: `tests/unit/main/system-notification.test.ts`

**Interfaces:**

```ts
type SystemNotificationPermissionStatus =
  | "unsupported" | "denied" | "unknown" | "authorized";

interface SystemNotificationPermissionSnapshot {
  status: SystemNotificationPermissionStatus;
  observedAt: number;
  source: "cached" | "forced-probe" | "attention-delivery" | "boot";
}

// showSystemNotification(req, { forceProbe?: boolean, onClick?, onUnavailable? })
// forceProbe===true → 忽略 stickyDenied 一次，真正 show
// shown:true → stickyDenied=false, status=authorized
// getSystemNotificationPermissionSnapshot(): snapshot
// openSystemNotificationSettings(): Promise<{ opened: boolean; reason?: string }>
// showTestSystemNotification(): uses forceProbe, kind agent.attention.test, no agentRef
```

广播：权限 status 变化时 `broadcast`（新 channel 如 `pier://notification:permission-changed`），设置页订阅。

- [ ] **Step 1: 测 sticky 阻断普通路径；forceProbe 可 show；shown:true 清 sticky**

- [ ] **Step 2: 实现 + IPC + preload**

- [ ] **Step 3:**

```bash
pnpm test:unit -- system-notification
pnpm test:unit -- notification-ipc
```

- [ ] **Step 4: 提交** `feat(notification): recoverable permission probe and test notification`

---

### Task 4: Renderer store + 通知设置 UI

**Files:**

- Create: `src/renderer/stores/agent-attention-preferences.store.ts`
- Create: `src/renderer/pages/settings/components/notifications-section.tsx`
- Modify: `appearance-nav.ts`（`notifications` after `agents`，Bell 图标）
- Modify: `settings-dialog.tsx`
- Modify: i18n en/zh-CN `settings.ts`
- Wire store init 与现有 preferences boot

**Store 纪律：**

```ts
async setAgentAttention(next: AgentAttentionSettings): Promise<void> {
  const prev = get().agentAttention;
  set({ agentAttention: next }); // 可选乐观
  try {
    const merged = await window.pier.preferences.update({ agentAttention: next });
    set({ agentAttention: merged.agentAttention });
  } catch (err) {
    set({ agentAttention: prev });
    showAppAlert({ title: t("...Failed"), body: ... }); // 或 toast.error 短失败
    throw err;
  }
}
```

**UI：** banner（订阅 permission snapshot）+ switches + cooldown select + 测试通知（forceProbe）+ 打开系统设置。无空「重新检查」。

- [ ] **Step 1–3: 实现 + typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: 提交** `feat(settings): notifications section for agent attention`

---

### Task 5: S3 文案 + hooks 门闸（优先 FA 入口）

**Files:**

- Modify: `agents-section.tsx` + i18n（hooks 关闭说明 = 设计 §5.4）
- Modify: notifications-section 在 `agentStatusHooks===false` 时 Alert
- **推荐：** Modify FA/jsonl 摄入（`foreground-activity` ipc 或 observer 回调前）—— `agentStatusHooks===false` 时丢弃 **新** agent hook 事件  
- Test: 门闸单测（mock prefs false → ingest 忽略 PermissionRequest）

若本迭代不做门闸：文案必须含「已运行会话可能仍上报；重开 Agent 后完全生效」，且不得在验收表声称即时全局安静。

- [ ] **Step 1–3: 文案 +（门闸|诚实文案）+ 测**

- [ ] **Step 4: 提交** `fix(agents): honest status-hooks-off semantics for attention`

---

### Task 6: B 档收敛 + S1/S2 证据门禁

**Files:**

- Review/modify as needed: `grok.ts` / `gemini.ts` / `droid.ts` / `cursor.ts`
- Update: design 附录 A（同分支）
- Create: `tests/unit/main/agent-waiting-evidence-gates.test.ts`
- Export pure mappers if needed（OpenCode `permission.updated` 分支）

**S1 每家必须：**

```ts
// 1) 从集成导出的 events 表或 mapNativeToPier(native) 断言 → PermissionRequest
// 2) activityStatusForHookEvent("PermissionRequest") === "waiting"
// 3) projectAgentActivities([...waiting agent...]) → needsYou >= 1
// 4) Attention observe 在 enabled+unfocused 时调用 showNotification
// Claude, Codex, Copilot, OpenCode 四条 it() 或 table-driven 四行，禁止注释代替
```

**S2：** launch-only 列表 + 无 status 的 needsYou===0 + Attention 不调用。

**B：** 每文件审完：保留则测锁定；删除映射则测「不再 PermissionRequest」+ 更新附录。

- [ ] **Step 1: 写门禁测（映射源先红则先改导出）**

- [ ] **Step 2: B 审落地**

- [ ] **Step 3:**

```bash
pnpm test:unit -- agent-waiting-evidence-gates
pnpm test:unit -- agent-hook-runtime-semantics
pnpm test:unit -- agent-attention
pnpm test:unit -- agent-runtime-index
```

- [ ] **Step 4: 提交** `fix(agents): converge B waiting maps and lock evidence gates`

---

### Task 7: 总验收

```bash
pnpm test:unit -- agent-attention
pnpm test:unit -- agent-attention-settings
pnpm test:unit -- preferences-service
pnpm test:unit -- system-notification
pnpm test:unit -- agent-waiting-evidence-gates
pnpm test:unit -- agent-runtime-index
pnpm typecheck
pnpm lint
```

手工：N1 关开关、N6 系统设置允许后测试通知、N7、真 waiting click、四家之一真机 permission（若环境允许）。

更新 design 状态 → 已实现（仅门禁全绿）。

`pnpm check` 发 PR 前。

---

## Spec 覆盖

| Spec | Task |
| --- | --- |
| PATCHABLE_KEYS / N8 | 1 |
| 触发矩阵 / enabled / suppress | 2 |
| forceProbe / 测试 / 打开设置 | 3 |
| 设置 UI / 失败可见 | 4 |
| S3 诚实 + 门闸 | 5 |
| S1 真链 / S2 / B | 6 |
| 总门禁 | 7 |

## 完成定义

- Codex P0 两条在测试中不可再发（白名单、sticky 恢复）  
- N1–N9、S1–S3 按修订 design 可证  
- B 附录与代码一致  
- 无完成通知/响铃/历史范围膨胀  
