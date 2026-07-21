# 智能体通知事件矩阵 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`。Checkbox 步骤。  
> **Commit 纪律：** 本仓库默认**不自动 commit**；各 Task 末尾的 commit 步骤仅在用户明确要求时执行。  
> **不做：** 音量滑条、自定义音频文件、按事件分音色、通知历史、终端 BEL、强制 Group Container 品牌 wav staging（可选附录）。

**Goal:** 把系统通知扩成三类用户可配置事件（需要你处理 / 回合完成 / 出错），默认对齐 Codex App；复用既有提示音管线；并诚实处理 omp/codex 的 FA `error` 可达性。

**Architecture:**

```text
FA 变迁
  → classifyAgentNotificationEvent(prev, next, settings)
      waiting | ready | error | null
  → per-event gate
      waiting: enabled + suppressWhenFocused(panel)
      ready:   turnNotifyMode off|unfocused|always + window focus
      error:   enableErrorAttention + suppressWhenFocused(panel)
  → shared cooldownMs(agentRef)
  → showSystemNotification + decideNotificationAudio
  → shown:true → maybePlayAfterShown（单窗）
```

**Tech Stack:** Electron Notification · FA · preferences/zod · vitest · 既有 Attention 声音管线 · i18n

**Spec:** [`docs/superpowers/specs/2026-07-19-agent-notification-events-design.md`](../specs/2026-07-19-agent-notification-events-design.md)

## Global Constraints

- ForegroundActivity 仍是唯一状态源；Index「需要你处理」**不计** `ready`。
- `enabled` **只**门控「需要你处理」(waiting)；**不得**再 `if (!enabled) return` 整段短路掉 ready/error。
- `turnNotifyMode` 默认 `unfocused`；旧磁盘缺字段 zod `.default` 合并，禁止整表 wipe。
- 回合完成聚焦判定：**拥有该智能体面板的 BrowserWindow `isFocused()`**（窗口级，对齐 Codex 主窗语义）；waiting/error 仍用现网 **目标 panel** 聚焦。
- 三类事件共用 `cooldownMs`（按 agentRef）；测试通知 exempt。
- 提示音：仅 `shown:true` 后；复用 `decideNotificationAudio` / `maybePlayAfterShown`；三类共用 `soundEnabled`/`soundId`。
- 通知 `kind` 继续 `agent.attention`（点击回跳不变）；用文案区分事件；tag 仍 `agent.attention:<agentRef>`。
- Ev5：只允许**真实**原生失败 → `error`；无证据则审计表标「不支持 error」，禁止假绿。
- 用户文案走 i18n；禁止业务内联中英用户串；产品词「智能体 / 需要你处理」。
- 测试：`pnpm test:unit -- <pattern>`；不跑全量 e2e 除非任务要求。
- 文件硬顶约 500 行；`attention-service.ts` 若继续胀，把事件分类抽到同目录纯模块。

---

## 文件地图

| 路径 | 职责 |
| --- | --- |
| `src/shared/contracts/agent-attention.ts` | `turnNotifyMode` schema + defaults |
| `src/shared/agent-attention-copy.ts` | 文案支持 `ready` |
| `src/main/services/agent-attention/notification-event.ts`（新建） | 纯函数：事件分类 + 门控（可单测） |
| `src/main/services/agent-attention/attention-service.ts` | observe 走新分类；注入 windowFocused |
| `src/main/services/agent-attention/notification-copy.ts` | 透传 ready |
| `src/main/ipc/agent-attention.ts` | `isOwnerWindowFocused` 接线 |
| `src/renderer/pages/settings/components/notifications-section.tsx` | 三组策略 UI |
| `src/renderer/i18n/locales/{zh-CN,en}/settings.ts` | 文案 |
| `src/main/services/agents/integrations/omp.ts` | Ev5：有证据才映 error |
| `src/main/services/agents/integrations/codex.ts`（及/或 transcript reconciler） | Ev5：有证据才映 error |
| `docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md` | 更新 omp/codex error 结论 |
| tests | 见各 Task |

---

## Phase map

| Phase | Tasks |
| --- | --- |
| 契约 + 迁移 | 1 |
| 事件分类纯函数 + Attention 接线 | 2 |
| 文案 ready | 3 |
| 设置 UI + i18n | 4 |
| Ev5 适配器可达性 | 5 |
| 回归验收 | 6 |

---

### Task 1: 契约扩展 `turnNotifyMode` + 迁移

**Files:**
- Modify: `src/shared/contracts/agent-attention.ts`
- Modify: `tests/unit/shared/agent-attention-settings.test.ts`
- Modify: `tests/unit/main/preferences-service-agent-attention.test.ts`（及所有写死 `AgentAttentionSettings` 字面量且缺新字段会炸的测试——优先改用 `DEFAULT_AGENT_ATTENTION_SETTINGS` 展开）

**Interfaces:**

```ts
export const TURN_NOTIFY_MODES = ["off", "unfocused", "always"] as const;
export type TurnNotifyMode = (typeof TURN_NOTIFY_MODES)[number];

// schema 增量：
turnNotifyMode: z.enum(TURN_NOTIFY_MODES).default("unfocused"),

// DEFAULT_AGENT_ATTENTION_SETTINGS:
turnNotifyMode: "unfocused",
```

**Produces:** 带 `turnNotifyMode` 的 settings；旧盘无该字段时 parse 为 `unfocused`。

- [x] **Step 1: 写失败测 — 默认含 turnNotifyMode；缺字段旧对象补齐且不 wipe 兄弟键**

```ts
// tests/unit/shared/agent-attention-settings.test.ts
it("defaults include turnNotifyMode unfocused", () => {
  expect(DEFAULT_AGENT_ATTENTION_SETTINGS.turnNotifyMode).toBe("unfocused");
});

it("parses legacy agentAttention without turnNotifyMode", () => {
  const parsed = agentAttentionSettingsSchema.parse({
    enabled: true,
    enableErrorAttention: false,
    suppressWhenFocused: true,
    cooldownMs: 180_000,
    soundEnabled: true,
    soundId: "system",
  });
  expect(parsed.turnNotifyMode).toBe("unfocused");
});

it("preferences parse keeps sibling keys when agentAttention lacks turnNotifyMode", () => {
  const parsed = projectPreferencesSchema.parse({
    agentStatusHooks: false,
    agentAttention: {
      enabled: true,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 180_000,
      soundEnabled: true,
      soundId: "system",
    },
  });
  expect(parsed.agentStatusHooks).toBe(false);
  expect(parsed.agentAttention.turnNotifyMode).toBe("unfocused");
});
```

- [x] **Step 2: 跑测确认失败（字段尚不存在）**

Run: `pnpm test:unit -- tests/unit/shared/agent-attention-settings.test.ts`  
Expected: FAIL（缺 `turnNotifyMode` 或默认不等）

- [x] **Step 3: 最小实现 — schema + defaults**

在 `agent-attention.ts` 增加 `TURN_NOTIFY_MODES`、schema 字段 `.default("unfocused")`、`DEFAULT_AGENT_ATTENTION_SETTINGS.turnNotifyMode = "unfocused"`。

- [x] **Step 4: 修所有字面量 settings 测试编译/断言**

凡手写完整 `AgentAttentionSettings` 对象处补 `turnNotifyMode`，或改为 `{ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ... }`。

- [x] **Step 5: 跑测通过**

Run: `pnpm test:unit -- tests/unit/shared/agent-attention-settings.test.ts tests/unit/main/preferences-service-agent-attention.test.ts`  
Expected: PASS

- [x] **Step 6: Commit（仅当用户要求）**

```bash
git add src/shared/contracts/agent-attention.ts \
  tests/unit/shared/agent-attention-settings.test.ts \
  tests/unit/main/preferences-service-agent-attention.test.ts
# 以及本 Task 触达的其它字面量修复文件
git commit -m "$(cat <<'EOF'
feat(attention): add turnNotifyMode preference default unfocused

EOF
)"
```

---

### Task 2: 事件分类 + Attention observe 接线

**Files:**
- Create: `src/main/services/agent-attention/notification-event.ts`
- Modify: `src/main/services/agent-attention/attention-service.ts`
- Modify: `src/main/ipc/agent-attention.ts`
- Modify: `tests/unit/main/agent-attention.test.ts`
- Create: `tests/unit/main/attention-notification-event.test.ts`（若与 service 测重复可合并，但矩阵必须覆盖）

**Interfaces:**

```ts
// notification-event.ts
export type AgentNotificationEventKind = "waiting" | "ready" | "error";

export function classifyAgentNotificationEvent(args: {
  previous: ActivityStatus | undefined;
  next: ActivityStatus | undefined;
  settings: Pick<
    AgentAttentionSettings,
    "enabled" | "enableErrorAttention" | "turnNotifyMode"
  >;
}): AgentNotificationEventKind | null;

export function shouldSuppressAgentNotification(args: {
  kind: AgentNotificationEventKind;
  settings: Pick<
    AgentAttentionSettings,
    "suppressWhenFocused" | "turnNotifyMode"
  >;
  isTargetPanelFocused: boolean;
  isOwnerWindowFocused: boolean;
}): boolean;
```

**分类规则钉死（单测必须锁）：**

| prev → next | settings | kind |
| --- | --- | --- |
| processing→waiting | enabled true | waiting |
| processing→waiting | enabled false | null |
| processing→ready | turnNotifyMode unfocused/always | ready |
| processing→ready | turnNotifyMode off | null |
| ready→ready | * | null |
| ∅→ready | turn ≠ off | ready |
| processing→error | enableErrorAttention true | error |
| processing→error | enableErrorAttention false | null |
| waiting→error | enableErrorAttention true | null（注意力 T 内不刷） |
| error→waiting | enabled true | null |
| waiting→ready | turn ≠ off | ready |
| error→ready | turn ≠ off | ready |

实现要点：

- `ready`：`previous !== "ready" && next === "ready" && turnNotifyMode !== "off"`。
- `waiting` / `error`：沿用「进入注意力触发集」边沿；触发集仍为 waiting +（可选）error；**但** `enabled` 只在 kind===waiting 时要求为 true；`enableErrorAttention` 只约束 error。
- 禁止再用「文件顶部 `if (!prefs.enabled) return`」一次性短路。

**抑制钉死：**

| kind | mode/flags | focused | suppress? |
| --- | --- | --- | --- |
| ready | unfocused | owner window focused | yes |
| ready | unfocused | owner window 未聚焦 | no |
| ready | always | window focused | no |
| ready | off | * | classify 已为 null |
| waiting | suppress true | panel focused | yes |
| waiting | suppress true | 仅窗口聚焦、panel 未聚焦 | no |
| error | 同 waiting | panel | 同 waiting |

`attention-service` 依赖扩展：

```ts
isOwnerWindowFocused(electronWindowId: string): boolean;
```

**observe 伪码：**

```ts
for (const activity of next.activities) {
  if (activity.kind !== "agent") continue;
  const agentRef = makeAgentRef(activity.windowId, activity.panelId);
  const prevStatus = prevMap.get(agentRef);
  const kind = classifyAgentNotificationEvent({
    previous: prevStatus,
    next: activity.status,
    settings: prefs,
  });
  if (kind == null) continue;

  if (
    shouldSuppressAgentNotification({
      kind,
      settings: prefs,
      isTargetPanelFocused: isTargetPanelFocused(
        activity.windowId,
        activity.panelId
      ),
      isOwnerWindowFocused: isOwnerWindowFocused(activity.windowId),
    })
  ) {
    continue;
  }

  // cooldown / copy / decideNotificationAudio / show / play — 与现网相同
}
```

`ipc/agent-attention.ts`：

```ts
function isOwnerWindowFocused(electronWindowId: string): boolean {
  const win = windowManager
    .getAll()
    .find((w) => String(w.id) === electronWindowId);
  return Boolean(win && !win.isDestroyed() && win.isFocused());
}
```

- [x] **Step 1: 写失败测 — classify/suppress 矩阵 + service ready 路径**

```ts
it("notifies on processing→ready when turnNotifyMode is unfocused and window unfocused", async () => {
  const service = createService(
    { turnNotifyMode: "unfocused" },
    { isOwnerWindowFocused: () => false }
  );
  await service.observe(
    {
      activities: [
        agent({ panelId: "p1", windowId: "1", status: "processing" }),
      ],
    },
    {
      activities: [agent({ panelId: "p1", windowId: "1", status: "ready" })],
    }
  );
  expect(showNotification).toHaveBeenCalledTimes(1);
});

it("skips ready notify when owner window focused and mode unfocused", async () => {
  const service = createService(
    { turnNotifyMode: "unfocused" },
    { isOwnerWindowFocused: () => true }
  );
  // processing→ready
  expect(showNotification).not.toHaveBeenCalled();
});

it("notifies ready even when focused if turnNotifyMode is always", async () => {
  /* … */
});

it("does not notify ready when turnNotifyMode is off", async () => {
  /* … */
});

it("notifies error when enableErrorAttention even if enabled is false", async () => {
  const service = createService({
    enabled: false,
    enableErrorAttention: true,
  });
  // processing→error → expect called
});

it("does not notify waiting when enabled is false", async () => {
  const service = createService({ enabled: false });
  // →waiting → not called
});
```

同时保留/更新既有 waiting/error/cooldown/sound 测；`createService` 增加 `isOwnerWindowFocused` mock，默认 `() => false`。

- [x] **Step 2: 跑测确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-attention.test.ts tests/unit/main/attention-notification-event.test.ts`  
Expected: FAIL（无 classify / 无 ready 路径）

- [x] **Step 3: 实现 `notification-event.ts` + 改 `attention-service` + ipc 窗口聚焦**

- [x] **Step 4: 跑测通过**

Run: `pnpm test:unit -- tests/unit/main/agent-attention.test.ts tests/unit/main/attention-notification-event.test.ts`  
Expected: PASS

- [x] **Step 5: Commit（仅当用户要求）**

```bash
git add src/main/services/agent-attention/notification-event.ts \
  src/main/services/agent-attention/attention-service.ts \
  src/main/ipc/agent-attention.ts \
  tests/unit/main/agent-attention.test.ts \
  tests/unit/main/attention-notification-event.test.ts
git commit -m "$(cat <<'EOF'
feat(attention): notify on turn-complete ready with turnNotifyMode

EOF
)"
```

---

### Task 3: 回合完成文案

**Files:**
- Modify: `src/shared/agent-attention-copy.ts`
- Modify: `src/main/services/agent-attention/notification-copy.ts`
- Modify: `tests/unit/main/agent-attention.test.ts`（format 测）

**文案（产品词，无实现词）：**

| locale | ready body |
| --- | --- |
| zh-CN | `${label} 回合已完成` |
| en | `${label} finished a turn` |

waiting/error 文案不变。

`notification-copy.ts`：`status` 允许 `ready`，不要再把非 waiting/error 折叠成 waiting。

```ts
const status =
  activity.status === "error" ||
  activity.status === "waiting" ||
  activity.status === "ready"
    ? activity.status
    : "waiting";
```

- [x] **Step 1: 写失败测 — ready 文案**

```ts
it("localizes ready bodies", () => {
  const ready = agent({ panelId: "p1", status: "ready", windowId: "1" });
  expect(formatAttentionNotificationCopy(ready, "zh-CN").body).toContain(
    "回合已完成"
  );
  expect(formatAttentionNotificationCopy(ready, "en").body).toContain(
    "finished a turn"
  );
});
```

- [x] **Step 2: 跑测失败 → 实现 → 跑测通过**

Run: `pnpm test:unit -- tests/unit/main/agent-attention.test.ts`

- [x] **Step 3: Commit（仅当用户要求）**

```bash
git commit -m "$(cat <<'EOF'
feat(attention): localize turn-complete notification copy

EOF
)"
```

---

### Task 4: 设置页三组策略 + i18n

**Files:**
- Modify: `src/renderer/pages/settings/components/notifications-section.tsx`
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts`
- Modify: `src/renderer/i18n/locales/en/settings.ts`
- 若有设置治理/快照测依赖文案键：同步更新

**UI 顺序（同一 FieldSet 内分组，可用小标题/说明段落，勿新开顶级 nav）：**

1. **需要你处理**：`enabled` Switch；更新 `enabledDesc`；去掉泄漏实现词的 hint。  
2. **回合完成**：`SelectRow` 绑定 `turnNotifyMode`——`off` / `unfocused` / `always`。  
3. **出错**：`enableErrorAttention`（保持）。  
4. **共用**：`suppressWhenFocused`（desc 写明主要作用于需要你处理与出错）、`cooldownMs`、`NotificationSoundBlock`。

**i18n 键（新增/修订）：**

```ts
// zh-CN 示例（en 对等）
enabled: "需要你处理时通知",
enabledDesc:
  "智能体在等你确认或继续时，通过本机系统通知提醒（关闭后标题栏计数仍更新）。",
turnNotifyMode: "回合完成时通知",
turnNotifyModeDesc: "智能体回合结束后是否提醒。默认仅在窗口未聚焦时。",
turnNotifyModeOptions: {
  off: "从不",
  unfocused: "仅窗口未聚焦时",
  always: "始终",
},
suppressDesc:
  "目标智能体面板已聚焦时，不发送「需要你处理」与「出错」类系统通知（回合完成由上方三档单独控制）。",
soundGroupDesc:
  "系统通知成功展示时播放。标题栏「需要你处理」计数不依赖此项。",
```

删除或改写含裸 `waiting)` 的 `waitingHint`（禁止实现词）。

- [x] **Step 1: 改 i18n 两侧 + PolicyCard 插入 SelectRow**

```tsx
<SelectRow<TurnNotifyMode>
  description={t("settings.notifications.turnNotifyModeDesc")}
  id="settings-attention-turn-notify-mode"
  label={t("settings.notifications.turnNotifyMode")}
  onChange={(next) => {
    patchAttention(
      { turnNotifyMode: next },
      setAgentAttention,
      failedTitle
    ).catch(() => undefined);
  }}
  options={TURN_NOTIFY_MODES.map((mode) => ({
    label: t(`settings.notifications.turnNotifyModeOptions.${mode}`),
    value: mode,
  }))}
  triggerWidth="w-[200px]"
  value={agentAttention.turnNotifyMode}
/>
```

导入 `TURN_NOTIFY_MODES` / `TurnNotifyMode`。

- [x] **Step 2: 类型检查 / 相关单测**

Run: `pnpm test:unit -- tests/unit/shared/agent-attention-settings.test.ts`  
若有 renderer 设置测，一并跑。手工：打开设置 → 通知，确认三组可见、保存后重启仍在。

- [x] **Step 3: Commit（仅当用户要求）**

```bash
git commit -m "$(cat <<'EOF'
feat(settings): expose turn-complete notification mode

EOF
)"
```

---

### Task 5: Ev5 — omp / codex `error` 可达性（诚实）

**Files（按证据结果取舍）：**
- Modify 可能：`src/main/services/agents/integrations/omp.ts`
- Modify 可能：`src/main/services/agents/integrations/codex.ts` 和/或 `codex-transcript-reconciler.ts`
- Modify：`docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md`
- Modify：`tests/unit/agent-integrations/omp.test.ts` 等映射测

**硬规则：** 无原生失败语义 → **禁止**把 `Stop` / `agent_end` / `TurnInterrupted` 假装成 `error`（用户中断 ≠ 出错）。

- [x] **Step 1: 证据 spike（只读，写进本 Task 结论）**

查：
1. omp 扩展事件流是否存在独立失败事件（文档 / 既有 2026-07-05 probe 笔记 / 源码）。已知：abort 仍 `agent_end→Stop`。  
2. Codex hooks / transcript 是否存在「失败」终态（非用户 abort）。已知：`turn_aborted→TurnInterrupted`、`task_complete→TurnCompleted`；hooks 表无 `StopFailure`。

对每一家输出三选一结论，写入审计表：
- **A.** 映射 `native → error`，并加单测锁映射源  
- **B.** 标明 `error: unsupported`（或等价），Ev5 对该家以文档+测试「映射表不含 error」为准，**不**假绿  
- **C.** 仅当有载荷可区分失败/中断时，解析载荷映 error（须单测覆盖区分）

- [x] **Step 2: 按结论改代码或只改审计**

若 A：更新 `OMP_EVENTS` / Codex 事件表或 reconciler；`omp.test.ts` 等断言含 error 映射。  
若 B：更新审计矩阵单元格；可选加测防回归装假。

- [x] **Step 3: Attention 回归 — enableErrorAttention 对「仍有真实 error 映射」的 Top A（如 claude `StopFailure`）仍通**

Run: `pnpm test:unit -- tests/unit/main/agent-attention.test.ts tests/unit/agent-integrations/omp.test.ts`  
（Codex 相关映射测按实际文件补。）

- [x] **Step 4: Commit（仅当用户要求）**

```bash
git commit -m "$(cat <<'EOF'
fix(agents): document or map omp/codex FA error reachability

EOF
)"
```

---

### Task 6: 回归与手工验收

**Files:** 无新功能码；可修测漂移。

- [x] **Step 1: 单元回归包**

Run:

```bash
pnpm test:unit -- \
  tests/unit/shared/agent-attention-settings.test.ts \
  tests/unit/main/preferences-service-agent-attention.test.ts \
  tests/unit/main/agent-attention.test.ts \
  tests/unit/main/attention-notification-audio.test.ts \
  tests/unit/main/attention-test-notification.test.ts \
  tests/unit/main/attention-sound-send.test.ts
```

Expected: PASS

- [ ] **Step 2: 手工清单（对照设计 §8）**

1. 设置「发送测试通知」：横幅 + 当前声音策略。  
2. 强制进入需要你处理：未聚焦有通知；聚焦目标 panel 且抑制开 → 无。  
3. `turnNotifyMode=unfocused`：回合 → ready，窗口未聚焦有通知；聚焦无。  
4. `always`：聚焦也有。  
5. `off`：ready 静默。  
6. 出错开关：对**有真实 error 映射**的智能体验证；omp/codex 按 Task 5 结论验收。  
7. 关提示音：可有横幅、无声。  
8. 确认标题栏「需要你处理」不因 ready 通知增加。

- [ ] **Step 3: 对照设计 Ev1–Ev8 再扫一遍** — 全部有 Task 覆盖后再收工。

---

## 计划自检（写作时已过）

| 设计项 | Task |
| --- | --- |
| Ev1 waiting + panel 抑制 | 2 |
| Ev2/Ev3 turnNotifyMode 三档 + 窗口聚焦 | 1+2+4 |
| Ev4 enableErrorAttention | 2（并修复 enabled 误伤 error） |
| Ev5 omp/codex 诚实可达 | 5 |
| Ev6 声音跟随 shown | 2 复用既有管线 + Task 6 回归 |
| Ev7 迁移 default | 1 |
| Ev8 设置页三组 | 4 |
| 废止完成音不做 | 已由 spec 声明；本计划实现覆盖 |
| 品牌 wav staging | 明确非门禁；本计划不做 |

**开放细节锁定：**
1. 回合完成聚焦 = **owner BrowserWindow.isFocused()**（非 panel）。  
2. ready 抖动先靠 `cooldownMs`。  
3. staging 品牌音 = 非本计划范围。
