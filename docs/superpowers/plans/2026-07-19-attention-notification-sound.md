# Agent Attention 提示音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Checkbox steps.  
> **Do not** expand into completion sounds, terminal BEL, volume slider, custom audio files, notification history, or plugin `playSound` API.

**Goal:** 按修订后设计落地「需要你处理」注意力提示音：`soundEnabled` + `soundId`、防双响、单窗播放、CSP/迁移/darwin `sound:default` 全锁。

**Architecture:**

```text
preferences.agentAttention (+ soundEnabled, soundId)
  → main Attention settings 缓存
  → decideNotificationAudio(settings, platform)
  → showSystemNotification({ silent, sound? })
  → shown:true + appSoundId
  → maybePlayAfterShown → sendToSingleWindow(ATTENTION_SOUND_PLAY)
  → renderer HTMLAudio (pier-asset://sounds/*)
```

**Tech Stack:** Electron Notification + HTMLAudioElement + zod preferences + pier-asset + vitest + 现有 NotificationsSection / Attention 管道。

**Spec:** [`docs/superpowers/specs/2026-07-19-attention-notification-sound-design.md`](../specs/2026-07-19-attention-notification-sound-design.md)（审查修订版）

## Global Constraints

- 触发仅 Attention（waiting；error 仅 `enableErrorAttention`）；仅 `shown:true` 后考虑应用音。
- 默认：`soundEnabled=true`, `soundId="system"` —— 升级零回归。
- 防双响表：system→OS 音；内置→OS silent+应用音；soundEnabled false→OS silent、无应用音。
- darwin system 路径必须 `sound: "default"`。
- **单窗** play（focused → 否则任一 live）；禁止 all-windows 各播一次。
- 全局 spacing 1000ms（试听/测试 exempt）；per-agent cooldown 不变。
- 旧四字段 `agentAttention` 磁盘必须 default 合并，**禁止**整表 preferences wipe。
- CSP 必须 `media-src` 含 `pier-asset:`。
- 文件硬顶 500 行；音频决策/播放/UI 块用新文件，勿继续胀 `system-notification.ts` / `notifications-section.tsx`。
- 用户文案走 i18n；禁止业务内联中英文用户串。
- Git：显式 stage 路径；commit 前按仓库规则。
- 测试：`pnpm test:unit -- <pattern>`；不跑全量 e2e 除非任务要求。

---

## 文件地图

| 路径 | 职责 |
| --- | --- |
| `src/shared/contracts/agent-attention.ts` | `ATTENTION_SOUND_IDS`、schema `.default`、defaults |
| `src/shared/attention-sound-catalog.ts` | soundId→文件名、内置列表、preview 可播判定 |
| `src/main/services/agent-attention/notification-audio.ts` | `decideNotificationAudio`、spacing、`maybePlayAfterShown`、单窗 send |
| `src/main/services/system-notification.ts` | `silent`/`sound` options → `new Notification` |
| `src/main/services/agent-attention/attention-service.ts` | show 端口带 audio options；shown 后 maybePlay |
| `src/main/ipc/agent-attention.ts` | 接线 decide + play；共享 settings |
| `src/main/ipc/notification.ts` | 测试通知同一 decide/play |
| `src/main/app-core/window-broadcasts.ts` | **单窗** `sendAttentionSoundPlay`（非 all-windows） |
| `src/shared/ipc-channels.ts` | `ATTENTION_SOUND_PLAY` + ALLOWED 列表 |
| `src/main/fonts/asset-protocol.ts` + 新 `sound-asset-paths.ts` | sounds host + 独立根目录 |
| `src/main/csp.ts` | `media-src` |
| `src/main/windows/window-manager.ts` | `autoplayPolicy: 'no-user-gesture-required'` |
| `electron-builder.yml` | extraResources notification-sounds |
| `resources/notification-sounds/*.wav` | 4 个自生成短音 |
| `src/renderer/lib/attention/play-attention-sound.ts` | 单例 HTMLAudio |
| `src/renderer/components/common/attention-sound-bridge.tsx` | 订阅 play 通道 |
| `src/renderer/pages/settings/components/notification-sound-block.tsx` | 提示音 UI 子块 |
| `src/renderer/pages/settings/components/notifications-section.tsx` | 挂载子块 |
| `src/renderer/i18n/locales/{zh-CN,en}/settings.ts` | 文案 |
| `NOTICE` | 自有音效说明 |
| tests | 见各 Task |

---

## Phase map

| Phase | Tasks |
| --- | --- |
| 契约 + 迁移 | 1 |
| 音频决策纯函数 | 2 |
| 资源 / 协议 / CSP | 3 |
| Notification silent/sound | 4 |
| 单窗 play + spacing + Attention 接线 | 5 |
| 测试通知 + autoplay | 6 |
| 设置 UI + i18n | 7 |
| 回归验收 | 8 |

---

### Task 1: 契约扩展 + 旧盘迁移

**Files:**
- Modify: `src/shared/contracts/agent-attention.ts`
- Create: `src/shared/attention-sound-catalog.ts`
- Modify: `tests/unit/shared/agent-attention-settings.test.ts`
- Modify: `tests/unit/main/preferences-service-agent-attention.test.ts`（及所有构造 `AgentAttentionSettings` 字面量的测试）

**Interfaces:**

```ts
// agent-attention.ts
export const ATTENTION_SOUND_IDS = [
  "system",
  "soft",
  "clear",
  "bright",
  "bell",
] as const;
export type AttentionSoundId = (typeof ATTENTION_SOUND_IDS)[number];

// schema fields:
soundEnabled: z.boolean().default(true),
soundId: z.enum(ATTENTION_SOUND_IDS).default("system"),

// attention-sound-catalog.ts
export const ATTENTION_BUILTIN_SOUND_IDS = ["soft","clear","bright","bell"] as const;
export function attentionSoundFileName(id: Exclude<AttentionSoundId,"system">): string;
// → `${id}.wav`
export function isPreviewableAttentionSoundId(id: AttentionSoundId): boolean;
// → id !== "system"
```

**Produces:** 带 sound 字段的 `AgentAttentionSettings`；catalog 常量。

- [ ] **Step 1: 写失败测 — 默认含 sound；四字段旧对象 parse 补齐**

```ts
// tests/unit/shared/agent-attention-settings.test.ts
it("defaults include soundEnabled true and soundId system", () => {
  expect(DEFAULT_AGENT_ATTENTION_SETTINGS).toEqual({
    enabled: true,
    enableErrorAttention: false,
    suppressWhenFocused: true,
    cooldownMs: 180_000,
    soundEnabled: true,
    soundId: "system",
  });
});

it("parses legacy four-field agentAttention without wiping", () => {
  const parsed = agentAttentionSettingsSchema.parse({
    enabled: false,
    enableErrorAttention: true,
    suppressWhenFocused: false,
    cooldownMs: 60_000,
  });
  expect(parsed).toEqual({
    enabled: false,
    enableErrorAttention: true,
    suppressWhenFocused: false,
    cooldownMs: 60_000,
    soundEnabled: true,
    soundId: "system",
  });
});

it("preferences parse keeps sibling keys when agentAttention is legacy", () => {
  const parsed = projectPreferencesSchema.parse({
    agentStatusHooks: false,
    agentAttention: {
      enabled: true,
      enableErrorAttention: false,
      suppressWhenFocused: true,
      cooldownMs: 180_000,
    },
  });
  expect(parsed.agentStatusHooks).toBe(false);
  expect(parsed.agentAttention.soundEnabled).toBe(true);
  expect(parsed.agentAttention.soundId).toBe("system");
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm test:unit -- agent-attention-settings
```

Expected: FAIL（缺 sound 字段 / 默认不匹配）

- [ ] **Step 3: 实现 schema + catalog + 更新 DEFAULT**

`agent-attention.ts`：加入 `ATTENTION_SOUND_IDS`、两字段 `.default`、更新 `DEFAULT_AGENT_ATTENTION_SETTINGS`。  
`attention-sound-catalog.ts`：文件名映射与 `isPreviewableAttentionSoundId`。

- [ ] **Step 4: 修复所有 `AgentAttentionSettings` 字面量测试**

凡手写四字段对象处补 `soundEnabled`/`soundId`，或改用 `DEFAULT_AGENT_ATTENTION_SETTINGS` spread。

- [ ] **Step 5: 跑测通过**

```bash
pnpm test:unit -- agent-attention-settings
pnpm test:unit -- preferences-service-agent-attention
pnpm test:unit -- agent-attention
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts/agent-attention.ts src/shared/attention-sound-catalog.ts \
  tests/unit/shared/agent-attention-settings.test.ts \
  tests/unit/main/preferences-service-agent-attention.test.ts \
  tests/unit/main/agent-attention.test.ts \
  tests/unit/main/agent-waiting-evidence-gates.test.ts \
  tests/integration/agent-runtime-index-attention.test.ts
# 仅 stage 实际改动的测试文件
git commit -m "feat(attention): add sound fields with legacy defaults"
```

---

### Task 2: `decideNotificationAudio` 纯函数

**Files:**
- Create: `src/main/services/agent-attention/notification-audio.ts`（先只放 decide + 类型；play 下 Task 补）
- Create: `tests/unit/main/attention-notification-audio.test.ts`

**Interfaces:**

```ts
export type NotificationAudioDecision = {
  silent: boolean;
  /** darwin + system + soundEnabled 时为 "default"；否则 undefined */
  sound?: "default";
  /** 需要应用播音时的内置 id；否则 null */
  appSoundId: "soft" | "clear" | "bright" | "bell" | null;
};

export function decideNotificationAudio(
  settings: Pick<AgentAttentionSettings, "soundEnabled" | "soundId">,
  platform: NodeJS.Platform = process.platform
): NotificationAudioDecision;
```

**Truth table:**

| soundEnabled | soundId | silent | sound (darwin) | appSoundId |
| --- | --- | --- | --- | --- |
| true | system | false | "default" | null |
| true | soft | true | omit | soft |
| false | * | true | omit | null |
| true | system | false | omit (win32/linux) | null |

- [ ] **Step 1: 失败测**

```ts
import { decideNotificationAudio } from "@main/services/agent-attention/notification-audio.ts";
import { describe, expect, it } from "vitest";

describe("decideNotificationAudio", () => {
  it("system + enabled on darwin uses OS default sound", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "system" },
        "darwin"
      )
    ).toEqual({ silent: false, sound: "default", appSoundId: null });
  });

  it("system + enabled on win32 omits sound name", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "system" },
        "win32"
      )
    ).toEqual({ silent: false, appSoundId: null });
  });

  it("builtin enables app sound and silences OS", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "clear" },
        "darwin"
      )
    ).toEqual({ silent: true, appSoundId: "clear" });
  });

  it("soundEnabled false silences OS and app", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: false, soundId: "bell" },
        "darwin"
      )
    ).toEqual({ silent: true, appSoundId: null });
  });
});
```

- [ ] **Step 2: 跑测 FAIL**

```bash
pnpm test:unit -- attention-notification-audio
```

- [ ] **Step 3: 实现 `decideNotificationAudio`**

```ts
export function decideNotificationAudio(settings, platform = process.platform) {
  if (!settings.soundEnabled) {
    return { silent: true, appSoundId: null };
  }
  if (settings.soundId === "system") {
    return platform === "darwin"
      ? { silent: false, sound: "default", appSoundId: null }
      : { silent: false, appSoundId: null };
  }
  return { silent: true, appSoundId: settings.soundId };
}
```

- [ ] **Step 4: 跑测 PASS + commit**

```bash
pnpm test:unit -- attention-notification-audio
git add src/main/services/agent-attention/notification-audio.ts \
  tests/unit/main/attention-notification-audio.test.ts
git commit -m "feat(attention): add decideNotificationAudio matrix"
```

---

### Task 3: 音效资源 + pier-asset + CSP + extraResources

**Files:**
- Create: `scripts/generate-notification-sounds.mjs`（一次性生成 4 个短 WAV，可提交产物）
- Create: `resources/notification-sounds/{soft,clear,bright,bell}.wav`
- Create: `src/main/sounds/sound-asset-paths.ts`
- Modify: `src/main/fonts/asset-protocol.ts`（扩展 sounds host；或拆 handler 仍单 scheme）
- Modify: `src/main/csp.ts`
- Modify: `electron-builder.yml`
- Modify: `NOTICE`
- Create: `tests/unit/main/sound-asset-paths.test.ts`
- Create: `tests/unit/main/csp-media-src.test.ts`（或扩展现有 csp 测）

**Interfaces:**

```ts
// sound-asset-paths.ts
export function soundAssetRootDir(): string;
// dev: cwd/resources/notification-sounds
// prod: process.resourcesPath/notification-sounds
// NEVER fonts root

export function resolveBundledSoundAbsolutePath(
  fileName: string
): string | null;
// whitelist via catalog file names only
```

**CSP:**

```ts
// buildCspPolicy both branches add:
"media-src 'self' pier-asset:",
// keep font-src as-is with pier-asset:
```

- [ ] **Step 1: 生成自有短 WAV（无第三方版权）**

`scripts/generate-notification-sounds.mjs`：写 4 个 mono PCM WAV，时长 **≤0.35s**，不同频率（如 440/523/659/784Hz），输出到 `resources/notification-sounds/`。  
运行：

```bash
node scripts/generate-notification-sounds.mjs
ls -la resources/notification-sounds
```

- [ ] **Step 2: 失败测 — root 非 fonts；CSP 含 media-src**

```ts
// sound-asset-paths.test.ts
expect(soundAssetRootDir().replace(/\\/g, "/")).toMatch(/notification-sounds$/);
expect(soundAssetRootDir()).not.toMatch(/fonts$/);
expect(resolveBundledSoundAbsolutePath("soft.wav")).toBeTruthy();
expect(resolveBundledSoundAbsolutePath("../fonts/x.ttf")).toBeNull();
expect(resolveBundledSoundAbsolutePath("evil.wav")).toBeNull();

// csp
expect(buildCspPolicy(false)).toContain("media-src");
expect(buildCspPolicy(false)).toContain("pier-asset:");
expect(buildCspPolicy(true)).toContain("media-src");
```

- [ ] **Step 3: 实现 paths + protocol + CSP + extraResources + NOTICE**

`asset-protocol.ts` handler 分支：

```ts
if (url.host === "fonts" && file.endsWith(".ttf")) { /* existing */ }
if (url.host === "sounds") {
  // only allow catalog basenames ending .wav
  // read from soundAssetRootDir()
  // content-type: audio/wav
}
return 404;
```

`electron-builder.yml`:

```yaml
  - from: resources/notification-sounds
    to: notification-sounds
```

`NOTICE` 增加：notification-sounds 为 Pier 生成的短提示音，随应用分发。

- [ ] **Step 4: 测 PASS + commit**

```bash
pnpm test:unit -- sound-asset-paths
pnpm test:unit -- csp
git add scripts/generate-notification-sounds.mjs resources/notification-sounds \
  src/main/sounds/sound-asset-paths.ts src/main/fonts/asset-protocol.ts \
  src/main/csp.ts electron-builder.yml NOTICE tests/unit/main/sound-asset-paths.test.ts \
  tests/unit/main/csp-media-src.test.ts
git commit -m "feat(attention): bundle notification sounds and media-src CSP"
```

---

### Task 4: `showSystemNotification` 支持 silent/sound

**Files:**
- Modify: `src/main/services/system-notification.ts`
- Modify: `tests/unit/main/system-notification.test.ts`

**Interfaces:**

```ts
export interface ShowSystemNotificationOptions {
  forceProbe?: boolean;
  onClick?: ...;
  onPermissionChanged?: ...;
  onUnavailable?: ...;
  /** 缺省 false */
  silent?: boolean;
  /** darwin system 路径传 "default" */
  sound?: string;
}
```

构造：

```ts
const notification = new Notification({
  title: request.title,
  silent: options.silent ?? false,
  ...(options.sound ? { sound: options.sound } : {}),
  ...(request.body ? { body: request.body } : {}),
  ...(isTestKind && process.platform === "darwin" ? { subtitle: "Pier" } : {}),
});
```

- [ ] **Step 1: 测 — silent true / sound default 传入 Electron mock**

扩展现有 electron Notification mock：捕获 constructor args。

```ts
it("forwards silent and sound options", async () => {
  electronMock.setAutoEmitShow(true);
  await showSystemNotification(
    { title: "t" },
    { silent: true, sound: "default" }
  );
  expect(electronMock.lastOptions).toMatchObject({
    silent: true,
    sound: "default",
  });
});

it("defaults silent false when omitted", async () => {
  electronMock.setAutoEmitShow(true);
  await showSystemNotification({ title: "t" });
  expect(electronMock.lastOptions.silent).toBe(false);
});
```

- [ ] **Step 2: 实现 + 测 PASS + commit**

```bash
pnpm test:unit -- system-notification
git add src/main/services/system-notification.ts tests/unit/main/system-notification.test.ts
git commit -m "feat(notification): honor silent and sound options"
```

---

### Task 5: 单窗 play + spacing + Attention 接线

**Files:**
- Modify: `src/main/services/agent-attention/notification-audio.ts`（maybePlay、spacing、reset for tests）
- Modify: `src/main/app-core/window-broadcasts.ts` — `sendAttentionSoundPlayToOneWindow`
- Modify: `src/shared/ipc-channels.ts` — `ATTENTION_SOUND_PLAY`
- Modify: `src/main/services/agent-attention/attention-service.ts` — 端口扩展
- Modify: `src/main/ipc/agent-attention.ts` — wrapper show + maybePlay
- Create: `src/renderer/lib/attention/play-attention-sound.ts`
- Create: `src/renderer/components/common/attention-sound-bridge.tsx`
- Modify: `src/renderer/components/common/app-shell.tsx` — mount bridge
- Modify: preload（`src/preload/index.ts` 或 notifications API）— `onAttentionSoundPlay`
- Modify: `tests/unit/main/agent-attention.test.ts`
- Modify: `tests/unit/main/attention-notification-audio.test.ts`

**Interfaces:**

```ts
// ipc-channels
PIER_BROADCAST.ATTENTION_SOUND_PLAY = "pier://attention-sound:play"
// payload: { soundId: "soft"|"clear"|"bright"|"bell" }

// notification-audio.ts
export const ATTENTION_SOUND_SPACING_MS = 1000;

export function resetAttentionSoundPlaybackStateForTests(): void;

export function maybePlayAfterShown(args: {
  decision: NotificationAudioDecision;
  /** 业务 false；试听/测试 true */
  force?: boolean;
  now?: () => number;
  sendToWindow?: (payload: { soundId: string }) => boolean;
}): "played" | "skipped-no-app-sound" | "skipped-spacing" | "skipped-no-window";

// attention-service showNotification port:
showNotification(
  request: SystemNotificationRequest,
  audio?: Pick<NotificationAudioDecision, "silent" | "sound">
): ...

// window-broadcasts
export function sendAttentionSoundPlayToOneWindow(payload: {
  soundId: string;
}): boolean;
// focused ?? getAll()[0]; webContents.send; destroyed skip; return whether sent
```

**Attention observe 补丁（逻辑）：**

```ts
const decision = decideNotificationAudio(prefs);
const result = await showNotification(request, {
  silent: decision.silent,
  sound: decision.sound,
});
if (result.shown) {
  lastNotified.set(agentRef, ts);
  maybePlayAfterShown({ decision, force: false });
}
```

**Renderer player：**

```ts
// play-attention-sound.ts
let audio: HTMLAudioElement | null = null;
let inflight = false;

export async function playAttentionSound(
  soundId: "soft" | "clear" | "bright" | "bell",
  opts?: { force?: boolean }
): Promise<void> {
  if (inflight && !opts?.force) return;
  inflight = true;
  try {
    audio ??= new Audio();
    audio.loop = false;
    audio.volume = 1;
    audio.src = `pier-asset://sounds/${soundId}.wav`;
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    console.warn("[attention-sound] play failed", {
      soundId,
      name: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  } finally {
    inflight = false;
  }
}
```

日志禁止 agentRef/title/body/绝对路径。

- [ ] **Step 1: 测 spacing + 单窗 send + Attention play 一次**

```ts
// attention-notification-audio.test.ts
it("spacing drops second business play within 1000ms", () => {
  resetAttentionSoundPlaybackStateForTests();
  const send = vi.fn(() => true);
  let t = 0;
  const decision = {
    silent: true,
    appSoundId: "soft" as const,
  };
  expect(
    maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
  ).toBe("played");
  t = 500;
  expect(
    maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
  ).toBe("skipped-spacing");
  t = 1500;
  expect(
    maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
  ).toBe("played");
  expect(send).toHaveBeenCalledTimes(2);
});

it("force bypasses spacing", () => { /* ... */ });

// agent-attention.test.ts
it("requests app sound only when shown and builtin", async () => {
  const play = vi.fn();
  // 通过注入或 spy maybePlay — 优先把 play 做成 createAgentAttentionService 可选依赖 playAttentionSound?
});
```

**端口设计（锁定，避免难测）：** 给 `createAgentAttentionService` 增加可选：

```ts
playAttentionSound?: (decision: NotificationAudioDecision) => void;
// 默认调 maybePlayAfterShown
```

单测 assert `playAttentionSound` 调用次数/参数，不直接依赖 windowManager。

- [ ] **Step 2: 实现 main 侧 decide 接线 + 单窗 send + renderer bridge**

`registerAgentAttention`：

```ts
showNotification: (request, audio) =>
  showSystemNotification(request, {
    silent: audio?.silent,
    sound: audio?.sound,
    onClick: ...,
    onPermissionChanged: ...,
    onUnavailable: ...,
  }),
// 在 service 内 shown 后 playAttentionSound(decision)
```

注意：service 必须在 show **前** `decideNotificationAudio(settings())`，把 decision 传入 show 与 play。

preload：订阅 `ATTENTION_SOUND_PLAY`，或 bridge 用 `window.pier` 新 API：

```ts
// 推荐 thin API
onAttentionSoundPlay(cb: (p: { soundId: string }) => void): () => void
```

`ALLOWED_RENDERER_CHANNELS` 必须包含新通道。

- [ ] **Step 3: 测 PASS**

```bash
pnpm test:unit -- attention-notification-audio
pnpm test:unit -- agent-attention
```

- [ ] **Step 4: Commit**

```bash
git add src/main/services/agent-attention/notification-audio.ts \
  src/main/services/agent-attention/attention-service.ts \
  src/main/ipc/agent-attention.ts \
  src/main/app-core/window-broadcasts.ts \
  src/shared/ipc-channels.ts \
  src/preload/index.ts \
  src/renderer/lib/attention/play-attention-sound.ts \
  src/renderer/components/common/attention-sound-bridge.tsx \
  src/renderer/components/common/app-shell.tsx \
  tests/unit/main/attention-notification-audio.test.ts \
  tests/unit/main/agent-attention.test.ts
git commit -m "feat(attention): play builtin sounds on shown via single window"
```

---

### Task 6: 测试通知同一音频决策 + autoplayPolicy

**Files:**
- Modify: `src/main/ipc/notification.ts`
- Modify: `src/main/windows/window-manager.ts`（`autoplayPolicy: "no-user-gesture-required"` + 注释）
- 可选：抽出 `getAgentAttentionSettingsCached(): AgentAttentionSettings` 供 attention ipc 与 notification ipc 共享（避免双缓存漂移）

**共享缓存策略（锁定）：**

在 `src/main/services/agent-attention/settings-cache.ts`（新，短文件）：

```ts
let cached = { ...DEFAULT, enabled: false }; // boot 保守
let ready = false;
export function initAgentAttentionSettingsCache(...): void;
export function getAgentAttentionSettingsCached(): AgentAttentionSettings;
export function setAgentAttentionSettingsCacheForTests(...): void;
```

`registerAgentAttention` 与 `registerNotificationIpc` 都读此缓存。  
测试通知：

```ts
ipcMain.handle(PIER.SYSTEM_NOTIFICATION_TEST, async () => {
  const settings = getAgentAttentionSettingsCached();
  const decision = decideNotificationAudio(settings);
  const result = await showTestSystemNotification({
    silent: decision.silent,
    sound: decision.sound,
    onClick: ...,
    onPermissionChanged,
  });
  if (result.shown) {
    maybePlayAfterShown({ decision, force: true }); // spacing exempt
  }
  return result;
});
```

- [ ] **Step 1: 测 — test path 使用 builtin 时 silent true 且 force play**

可用 unit 测 `decide` + 薄包装函数 `deliverAttentionTestNotification(...)` 抽到可测模块，避免硬 mock ipcMain。

```ts
// tests/unit/main/attention-test-notification.test.ts
it("applies audio decision and force-plays after shown", async () => {
  const show = vi.fn(async () => ({ shown: true }));
  const play = vi.fn();
  await runAttentionTestNotification({
    settings: { ...DEFAULT, soundId: "bell", soundEnabled: true },
    showTest: show,
    play,
  });
  expect(show).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ silent: true })
  );
  expect(play).toHaveBeenCalledWith(
    expect.objectContaining({ force: true })
  );
});
```

- [ ] **Step 2: 实现共享缓存 + test 接线 + autoplayPolicy**

```ts
// window-manager webPreferences
autoplayPolicy: "no-user-gesture-required", // attention HTMLAudio without gesture
```

- [ ] **Step 3: 测 PASS + commit**

```bash
pnpm test:unit -- attention-test-notification
pnpm test:unit -- agent-attention
git add src/main/services/agent-attention/settings-cache.ts \
  src/main/ipc/agent-attention.ts src/main/ipc/notification.ts \
  src/main/windows/window-manager.ts \
  tests/unit/main/attention-test-notification.test.ts
git commit -m "feat(attention): share sound decision on test notifications"
```

---

### Task 7: 设置 UI + i18n

**Files:**
- Create: `src/renderer/pages/settings/components/notification-sound-block.tsx`
- Modify: `src/renderer/pages/settings/components/notifications-section.tsx`（PolicyCard 内挂载，保持文件不爆 500）
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts`
- Modify: `src/renderer/i18n/locales/en/settings.ts`
- Create: `tests/unit/renderer/notification-sound-block.test.tsx`（若 component 测更合适则 `tests/component/`）

**UI 行为：**

- 子组标题：`soundGroup` / `soundGroupDesc`（从属系统通知成功展示）
- Switch：`soundEnabled`
- Select：`system` + 4 builtins，**label 用 locale 显示名**
- 试听 Button：`disabled={!isPreviewableAttentionSoundId(soundId)}`；点击 → `playAttentionSound(id, { force: true })`；失败 toast.error / showAppAlert
- `system` 时静态 helper：引导「发送测试通知」——**无 toast**
- `soundEnabled=false` 时 Select/试听仍可用（试听仍可听音色）
- patch 走既有 `patchAttention` / `setAgentAttention`

**Locale 键（必须中英都加）：**

```ts
soundGroup: "提示音" / "Alert sound"
soundGroupDesc: "需要你处理且系统通知成功展示时播放。标题栏「需要你处理」不依赖此项。"
soundEnabled: "启用提示音"
soundEnabledDesc: "关闭后仍可显示系统通知横幅，但不播放提示音（系统通知将静音）。"
soundId: "音色"
soundIdDesc: "系统默认跟随操作系统。内置音在应用内播放，不一定遵循系统专注模式对通知音的全部抑制。"
soundPreview: "试听所选应用音效"
soundPreviewSystemHint: "系统默认音无法在应用内试听，请使用下方「发送测试通知」。"
soundPreviewFailed: "无法播放提示音"
sound: { system, soft, clear, bright, bell } // 显示名
// testHint 可补一句提及当前策略
```

- [ ] **Step 1: 组件测 — system 禁用试听；builtin 可点**

```tsx
// 用现有 test utils 渲染 NotificationSoundBlock
// soundId=system → preview button disabled
// soundId=soft → enabled；click 调用 mock play
```

- [ ] **Step 2: 实现 block + 挂载 + i18n**

- [ ] **Step 3: 测 PASS + commit**

```bash
pnpm test:unit -- notification-sound
# or pnpm test:component -- notification-sound
git add src/renderer/pages/settings/components/notification-sound-block.tsx \
  src/renderer/pages/settings/components/notifications-section.tsx \
  src/renderer/i18n/locales/zh-CN/settings.ts \
  src/renderer/i18n/locales/en/settings.ts \
  tests/unit/renderer/notification-sound-block.test.tsx
git commit -m "feat(settings): attention alert sound controls"
```

---

### Task 8: 类型检查与回归验收

**Files:** 无新功能；修类型/测试漂移。

- [ ] **Step 1: typecheck + 相关单测**

```bash
pnpm typecheck
pnpm test:unit -- agent-attention
pnpm test:unit -- attention-notification-audio
pnpm test:unit -- attention-test-notification
pnpm test:unit -- system-notification
pnpm test:unit -- agent-attention-settings
pnpm test:unit -- preferences-service-agent-attention
pnpm test:unit -- sound-asset-paths
pnpm test:unit -- csp
```

Expected: 全 PASS

- [ ] **Step 2: 手工清单（执行者勾选）**

按 spec §7.2：

1. 默认 system：waiting → 仅系统音（macOS 确认有声）  
2. 内置：单窗一记、无双响；第二窗仍一记  
3. 关提示音：横幅静音  
4. 聚焦抑制 / 冷却：无声无横幅  
5. 试听 builtin OK；system 按钮 disabled  
6. 测试通知走当前策略  
7. 中英文文案  

- [ ] **Step 3: 最终 commit（若有修复）**

```bash
git commit -m "test(attention): fix sound follow-ups from typecheck"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| soundEnabled/soundId + defaults | 1 |
| 四字段迁移不 wipe | 1 |
| decide 表 + darwin default | 2, 4 |
| 资源 + pier-asset whitelist + 独立 root | 3 |
| CSP media-src | 3 |
| Notification silent/sound | 4 |
| shown 后 play | 5 |
| 单窗所有者 | 5 |
| spacing 1s | 5 |
| HTMLAudio singleton + force preview | 5, 7 |
| 测试通知同一决策 | 6 |
| autoplayPolicy | 6 |
| 设置 UI / system 禁用试听 / 层级文案 | 7 |
| i18n | 7 |
| catalog ≤4 短音 | 3, 1 |
| 不完成音/BEL/音量/自定义文件 | Global Constraints |
| Snd1–Snd9 测 | 1–8 |

## Placeholder scan

无 TBD/TODO 实施洞；音效用自生成 WAV，不依赖外部版权包。

## Type consistency

- `AttentionSoundId` / builtin union 与 `appSoundId` 一致  
- 通道名 `ATTENTION_SOUND_PLAY` 与 preload/bridge 一致  
- `maybePlayAfterShown` force 语义：测试/试听 true，业务 false  

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-attention-notification-sound.md`.**

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 新子代理 + 任务间审查  
2. **Inline Execution** — 本会话按 executing-plans 批量推进并设检查点  

Which approach?
