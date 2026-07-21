# 智能体 Composer 输入层 V0 实现计划（修订 v4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终端面板检测到**智能体 TUI**（foreground-activity `kind === "agent"`）时，在面板底部直接展示 Cursor/Codex 风格输入卡片作为**主输入**：点击终端聚焦到卡片而非终端、Enter 直接发送到 agent、控制键（Esc / Ctrl+C / 方向键等）透传给 TUI；开关放在智能体设置。

**Architecture:** 四条链路组装——(1) 注入：`pier:terminal:send-text` IPC 复用 main 侧 `addon.sendText`；(2) 挂载：renderer `foreground-activity.store` 的 per-panel activity 驱动（agent 态挂载、退出即卸载），无折叠态无快捷键；(3) 键盘接管：composer 持有 overlayFocus 声明 + takeover 注册表拦截 workspace-host 两处「焦点归还终端」调用，点击终端重定向聚焦 composer；(4) 布局：卡片实测高度上报 → CSS 变量 → anchor 缩排 → 现有 `setFrame` 链路同步 native。零 native / Swift 改动。

**Tech Stack:** Electron 42 · React 19 · TS strict · zustand · zod · Tailwind v4（`field-sizing-content`）· vitest · Playwright e2e

**设计决策（v4 定稿，覆盖 v3）：**

- **出现逻辑**：`activity.kind === "agent"` 时直接展示展开卡片（含 `source: "launch"` 先验；`codex update` 这类非会话子命令会短暂误挂载，接受）；非 agent 态不渲染。**删除**折叠态、panel params 持久化、Cmd+I toggle、右键 action。
- **键盘所有权**：composer 挂载即接管——auto-focus + `activateOverlay` 常驻；点击终端内容/激活面板时经 takeover 注册表重定向聚焦 composer（不再 `yieldToTerminal` / `requestTerminalFocusIntent`）；agent 退出卸载时归还终端键盘。鼠标选区/滚动仍是 native 行为，不受影响。
- **控制键透传**（textarea keydown，IME 组合中除外）：`Ctrl+C → \x03`、`Esc → \x1b` 任何时候透传（打断/取消语义）；textarea 为空时 `↑ \x1b[A` `↓ \x1b[B` `→ \x1b[C` `← \x1b[D` `Tab \t` `Shift+Tab \x1b[Z` `Enter \r` 透传（覆盖 claude/codex 的菜单选择、权限确认、模式切换）；有内容时 Enter 发送文本+`\r`，Shift+Enter 换行。
- **UI 形态**（沿用 v3）：浮动圆角卡片 `inset-x-2` + 8px 间距 + `rounded-lg border bg-popover shadow`；textarea `field-sizing-content` 自动增高 `max-h-48`；发送键有内容时实心。动作行右下留 V1 模式 chip 位、左侧留 V2 provider 位。
- **设置**：`agentComposerEnabled`（默认开）放**智能体设置 section**（`agents-section.tsx`），不放终端 section。
- V0 不做：shell 提示符态展示（V1）、发送历史、富编辑器（V2）、语音输入、草稿持久化。

## Global Constraints

- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 文案走 i18n key，zh-CN 与 en 同步；禁止内联字符串。
- 反馈规范：发送成功靠终端回显不加 toast；失败必须 `toast.error(t("terminal.composer.sendFailed"), { description })`（`sonner` 直接 import）。
- 文件小而聚焦（`check:file-size` 守卫）；新逻辑放独立文件。
- Git 安全协议：提交检查点先 stage 明确路径、展示 `git diff --staged` 与 Conventional Commits message、**等用户确认**；禁止 `git add .`。
- 每任务末跑 `pnpm typecheck && pnpm lint`；计划末尾跑完整 `pnpm check`。

---

### Task 1: sendText 契约 + preload + main IPC 通道

**Files:**

- Modify: `src/shared/contracts/terminal.ts`（`TerminalOperationResult` 在 251-254 行附近；`TerminalAPI` 接口 317 行起）
- Modify: `src/preload/terminal-api.ts`（`performOperation` 绑定 70-71 行附近）
- Modify: `src/main/ipc/terminal-operations.ts`（文件末尾追加）
- Modify: `src/main/ipc/terminal.ts`（`pier:terminal:perform-operation` 注册块 228-238 行附近，同模式追加）
- Test: `tests/unit/main/terminal-send-text.test.ts`（新建）

**Interfaces:**

- Produces: `TerminalSendTextArgs { panelId: string; submit?: boolean | undefined; text: string }`；`TerminalAPI.sendText(args): Promise<TerminalOperationResult>`；通道 `"pier:terminal:send-text"`；main 纯函数 `sendTerminalText(opts: { addon: NativeAddon | null; args: unknown; loadError: string | null; win: AppWindow | null }): TerminalOperationResult`。
- 授权面与 `perform-operation` 同构：`windowFromWebContents(event.sender)` 限定发起窗口；不进 `PierCommand`。
- **Step 1: 写失败的单元测试**

新建 `tests/unit/main/terminal-send-text.test.ts`（import 相对路径风格对齐同目录 `app-menu.test.ts`）：

```ts
import { describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";
import type { NativeAddon } from "../../../src/main/ipc/terminal-native-addon.ts";
import { sendTerminalText } from "../../../src/main/ipc/terminal-operations.ts";

function fakeAddon(sendText: (id: string, text: string) => boolean): NativeAddon {
  return { sendText: vi.fn(sendText) } as unknown as NativeAddon;
}
const win = { id: 7 } as unknown as AppWindow;

describe("sendTerminalText", () => {
  it("submit=true 时在文本末尾追加 \\r 并按窗口前缀路由", () => {
    const addon = fakeAddon(() => true);
    const result = sendTerminalText({
      addon,
      args: { panelId: "terminal-a", submit: true, text: "echo hi" },
      loadError: null,
      win,
    });
    expect(result).toEqual({ ok: true });
    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-a", "echo hi\r");
  });

  it("不带 submit 时原样透传（控制序列 / 多行都走这里）", () => {
    const addon = fakeAddon(() => true);
    sendTerminalText({
      addon,
      args: { panelId: "terminal-a", text: "\u001b[A" },
      loadError: null,
      win,
    });
    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-a", "\u001b[A");
  });

  it("addon 未加载返回 loadError", () => {
    const result = sendTerminalText({
      addon: null,
      args: { panelId: "terminal-a", text: "x" },
      loadError: "boom",
      win,
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("拒绝空文本 / 空 panelId / 超长文本 / 非对象参数", () => {
    const addon = fakeAddon(() => true);
    for (const args of [
      { panelId: "terminal-a", text: "" },
      { panelId: "", text: "x" },
      { panelId: "terminal-a", text: "x".repeat(64_001) },
      "not-an-object",
    ]) {
      const result = sendTerminalText({ addon, args, loadError: null, win });
      expect(result.ok).toBe(false);
    }
    expect(addon.sendText).not.toHaveBeenCalled();
  });

  it("窗口缺失与 surface 未就绪各返回明确错误", () => {
    const addon = fakeAddon(() => false);
    expect(
      sendTerminalText({
        addon,
        args: { panelId: "terminal-a", text: "x" },
        loadError: null,
        win: null,
      }).ok
    ).toBe(false);
    const notReady = sendTerminalText({
      addon,
      args: { panelId: "terminal-a", text: "x" },
      loadError: null,
      win,
    });
    expect(notReady).toEqual({ ok: false, error: "terminal surface not ready" });
  });
});
```

- **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/main/terminal-send-text.test.ts`
Expected: FAIL —— `sendTerminalText` 未导出。

- **Step 3: 实现契约 + helper + 通道**

`src/shared/contracts/terminal.ts` —— `TerminalOperationResult` 之后添加：

```ts
export interface TerminalSendTextArgs {
  panelId: string;
  /** true 时在文本末尾追加 "\r"，等价按下回车提交。 */
  submit?: boolean | undefined;
  text: string;
}
```

`TerminalAPI` 接口内（按字母序放在 `search` 之后）：

```ts
  /**
   * 向已存在 terminal panel 的 PTY 直写 UTF-8 文本（绕过按键翻译）。
   * shell 开启 bracketed paste (mode 2004) 时 libghostty 自动包裹粘贴标记。
   * surface 未就绪返回 { ok: false }——调用方负责 toast，不做重试。
   */
  sendText(args: TerminalSendTextArgs): Promise<TerminalOperationResult>;
```

`src/preload/terminal-api.ts` —— `search` 绑定之后添加：

```ts
  sendText: (args) => ipcRenderer.invoke("pier:terminal:send-text", args),
```

`src/main/ipc/terminal-operations.ts` —— 文件末尾追加（`toNativePanelKey` 已在文件头 import）：

```ts
/** 对齐 renderer-command.ts 中 terminal.open initialInput 的 64k 上限。 */
const MAX_SEND_TEXT_LENGTH = 64_000;

interface ParsedSendTextArgs {
  panelId: string;
  submit: boolean;
  text: string;
}

function parseSendTextArgs(value: unknown): ParsedSendTextArgs | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.panelId !== "string" || record.panelId === "") {
    return null;
  }
  if (
    typeof record.text !== "string" ||
    record.text.length === 0 ||
    record.text.length > MAX_SEND_TEXT_LENGTH
  ) {
    return null;
  }
  if (record.submit !== undefined && typeof record.submit !== "boolean") {
    return null;
  }
  return {
    panelId: record.panelId,
    submit: record.submit === true,
    text: record.text,
  };
}

export function sendTerminalText(opts: {
  addon: NativeAddon | null;
  args: unknown;
  loadError: string | null;
  win: AppWindow | null;
}): TerminalOperationResult {
  if (!opts.addon) {
    return { ok: false, error: opts.loadError ?? "native addon not loaded" };
  }
  const parsed = parseSendTextArgs(opts.args);
  if (!parsed) {
    return { ok: false, error: "invalid send text args" };
  }
  if (!opts.win) {
    return { ok: false, error: "window not found" };
  }
  try {
    const payload = parsed.submit ? `${parsed.text}\r` : parsed.text;
    const ok = opts.addon.sendText(
      toNativePanelKey(opts.win, parsed.panelId),
      payload
    );
    return ok
      ? { ok: true }
      : { ok: false, error: "terminal surface not ready" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

`src/main/ipc/terminal.ts` —— 紧跟 `pier:terminal:perform-operation` 注册块之后（`sendTerminalText` 加进文件头既有 import）：

```ts
  ipcMain.handle("pier:terminal:send-text", (event, args: unknown) =>
    sendTerminalText({
      addon,
      args,
      loadError,
      win: windowFromWebContents(event.sender),
    })
  );
```

- **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/main/terminal-send-text.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS。

- **Step 5: 提交检查点（需用户确认）**

```bash
git add src/shared/contracts/terminal.ts src/preload/terminal-api.ts src/main/ipc/terminal-operations.ts src/main/ipc/terminal.ts tests/unit/main/terminal-send-text.test.ts
git diff --staged
# 拟用 message: feat(terminal): add send-text IPC channel writing to pty via addon.sendText
```

---

### Task 2: `agentComposerEnabled` 偏好全链

**Files:**

- Modify: `src/shared/contracts/preferences.ts`（`terminalPasteProtection` 字段 96-98 行附近同区添加）
- Modify: `src/main/state/preferences.ts`（defaults 对象 39 行附近）
- Modify: `src/main/services/preferences-service.ts`（`PATCHABLE_KEYS` 30-55 行）
- Modify: `src/renderer/stores/terminal-preferences.store.ts`
- Test: `tests/unit/preferences-schema.test.ts`（扩展）、`tests/unit/terminal-preferences-store.test.ts`（扩展）

**Interfaces:**

- Produces: `ProjectPreferences.agentComposerEnabled: boolean`（默认 `true`）；renderer `useTerminalPreferencesStore((s) => s.agentComposerEnabled)` + `setAgentComposerEnabled(next: boolean): Promise<void>`。
- 说明: `preferences-patch.ts` 自动派生、`PreferenceChangedKey = keyof ProjectPreferences` 自动扩展，均无需改。
- **Step 1: 写失败的测试**

`tests/unit/preferences-schema.test.ts` 添加：

```ts
it("agentComposerEnabled 默认开启", () => {
  const parsed = projectPreferencesSchema.parse({});
  expect(parsed.agentComposerEnabled).toBe(true);
});
```

`tests/unit/terminal-preferences-store.test.ts` 添加：照抄同文件 `terminalPasteProtection` 用例（mock `window.pier.preferences.update` → 调 `setAgentComposerEnabled(false)` → 断言 update 收到 `{ agentComposerEnabled: false }` 且 store 值更新）。

- **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/preferences-schema.test.ts tests/unit/terminal-preferences-store.test.ts`
Expected: FAIL。

- **Step 3: 实现**

`src/shared/contracts/preferences.ts`：常量区加 `export const DEFAULT_AGENT_COMPOSER_ENABLED = true;`；schema `terminalPasteProtection` 之后加：

```ts
  agentComposerEnabled: z.boolean().default(DEFAULT_AGENT_COMPOSER_ENABLED),
```

`src/main/state/preferences.ts`：defaults 加 `agentComposerEnabled: DEFAULT_AGENT_COMPOSER_ENABLED,`。

`src/main/services/preferences-service.ts`：`PATCHABLE_KEYS` 按字母序插入 `"agentComposerEnabled",`（`"agentCommandOverrides"` 之后）。

`src/renderer/stores/terminal-preferences.store.ts`：snapshot 接口 + 初始值 + `setAgentComposerEnabled` setter（照 `setTerminalPasteProtection` 同构）+ 两处 `_hydrate` 映射补字段。`runtimeConfigFrom` **不加**。

- **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/preferences-schema.test.ts tests/unit/terminal-preferences-store.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS。

- **Step 5: 提交检查点（需用户确认）**

```bash
git add src/shared/contracts/preferences.ts src/main/state/preferences.ts src/main/services/preferences-service.ts src/renderer/stores/terminal-preferences.store.ts tests/unit/preferences-schema.test.ts tests/unit/terminal-preferences-store.test.ts
git diff --staged
# 拟用 message: feat(preferences): add agentComposerEnabled preference (default on)
```

---

### Task 3: TerminalComposer 组件（agent 主输入卡片 + 控制键透传）+ i18n

**Files:**

- Create: `src/renderer/panel-kits/terminal/terminal-composer.tsx`
- Create: `src/renderer/panel-kits/terminal/terminal-composer-passthrough.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/terminal.ts` + `en/terminal.ts`
- Test: `tests/unit/renderer/terminal-composer-passthrough.test.ts` + `tests/unit/renderer/terminal-composer.test.tsx`（均新建）

**Interfaces:**

- Consumes: Task 1 `window.pier.terminal.sendText`；`useTerminalStore`（`activateOverlay` / `deactivateOverlay`）与 `useTerminalOverlayFocus`；Task 4 的 `registerTerminalComposerTakeover`（本任务先写组件对它的调用，Task 4 提供实现——**若并行开发，本任务先在 stores 建好该文件**，见 Task 4 Step 1 的文件内容，两个任务以先合入者为准）。
- Produces:
  - `TerminalComposer` props `{ bottomOffsetPx: number; disabled: boolean; onHeightChange: (heightPx: number) => void; panelId: string }`；导出 `TERMINAL_COMPOSER_GAP_PX = 8`；testid `terminal-composer` / `terminal-composer-input` / `terminal-composer-send`。
  - `passthroughSequenceForKey(input: { altKey: boolean; ctrlKey: boolean; empty: boolean; key: string; metaKey: boolean; shiftKey: boolean }): string | null`（纯函数，见透传表）。
- **Step 1: 写失败的透传纯函数测试**

`tests/unit/renderer/terminal-composer-passthrough.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { passthroughSequenceForKey } from "../../../src/renderer/panel-kits/terminal/terminal-composer-passthrough.ts";

const base = {
  altKey: false,
  ctrlKey: false,
  empty: true,
  key: "",
  metaKey: false,
  shiftKey: false,
};

describe("passthroughSequenceForKey", () => {
  it("Esc / Ctrl+C 任何时候透传", () => {
    expect(passthroughSequenceForKey({ ...base, empty: false, key: "Escape" })).toBe("\u001b");
    expect(
      passthroughSequenceForKey({ ...base, empty: false, key: "c", ctrlKey: true })
    ).toBe("\u0003");
  });

  it("空输入时方向键 / Tab / Shift+Tab / Enter 透传", () => {
    expect(passthroughSequenceForKey({ ...base, key: "ArrowUp" })).toBe("\u001b[A");
    expect(passthroughSequenceForKey({ ...base, key: "ArrowDown" })).toBe("\u001b[B");
    expect(passthroughSequenceForKey({ ...base, key: "ArrowRight" })).toBe("\u001b[C");
    expect(passthroughSequenceForKey({ ...base, key: "ArrowLeft" })).toBe("\u001b[D");
    expect(passthroughSequenceForKey({ ...base, key: "Tab" })).toBe("\t");
    expect(passthroughSequenceForKey({ ...base, key: "Tab", shiftKey: true })).toBe("\u001b[Z");
    expect(passthroughSequenceForKey({ ...base, key: "Enter" })).toBe("\r");
  });

  it("非空输入时编辑键不透传（Enter 归发送路径）", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter"]) {
      expect(passthroughSequenceForKey({ ...base, empty: false, key })).toBeNull();
    }
  });

  it("普通字符 / meta 组合不透传", () => {
    expect(passthroughSequenceForKey({ ...base, key: "a" })).toBeNull();
    expect(
      passthroughSequenceForKey({ ...base, key: "c", metaKey: true, ctrlKey: false })
    ).toBeNull();
  });
});
```

Run: `pnpm vitest run tests/unit/renderer/terminal-composer-passthrough.test.ts` → FAIL。

- **Step 2: 实现透传纯函数**

`terminal-composer-passthrough.ts`：

```ts
/**
 * Composer 接管键盘期间仍要送达 agent TUI 的控制键 → PTY 序列。
 * 返回 null = composer 自己消费（正常编辑 / 发送路径）。
 */
export function passthroughSequenceForKey(input: {
  altKey: boolean;
  ctrlKey: boolean;
  empty: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (input.metaKey) {
    return null;
  }
  if (input.ctrlKey) {
    return input.key.toLowerCase() === "c" ? "\u0003" : null;
  }
  if (input.key === "Escape") {
    return "\u001b";
  }
  if (!input.empty) {
    return null;
  }
  switch (input.key) {
    case "ArrowUp":
      return "\u001b[A";
    case "ArrowDown":
      return "\u001b[B";
    case "ArrowRight":
      return "\u001b[C";
    case "ArrowLeft":
      return "\u001b[D";
    case "Tab":
      return input.shiftKey ? "\u001b[Z" : "\t";
    case "Enter":
      return input.shiftKey ? null : "\r";
    default:
      return null;
  }
}
```

Run: `pnpm vitest run tests/unit/renderer/terminal-composer-passthrough.test.ts` → PASS。

- **Step 3: i18n key（zh-CN + en 同步）**

`zh-CN/terminal.ts` 的 `terminal` 对象内添加：

```ts
  composer: {
    keyHint: "⏎ 发送 · ⇧⏎ 换行 · Esc 打断",
    label: "智能体输入框",
    placeholder: "发送给智能体…",
    send: "发送",
    sendFailed: "发送到终端失败",
  },
```

`en/terminal.ts`：

```ts
  composer: {
    keyHint: "⏎ send · ⇧⏎ newline · Esc interrupt",
    label: "Agent composer",
    placeholder: "Send to the agent…",
    send: "Send",
    sendFailed: "Failed to send to terminal",
  },
```

- **Step 4: 写失败的组件测试**

`tests/unit/renderer/terminal-composer.test.tsx`（render/mock 脚手架抄 `tests/unit/renderer/terminal-status-bar.test.tsx`；`ResizeObserver` stub 参考 `tests/unit/terminal-layout-coordinator.test.ts`）。用例清单：

```tsx
// 1. 渲染即为展开卡片（testid terminal-composer），无折叠形态。
// 2. 输入 "fix bug" 按 Enter → sendText 收到
//    { panelId: "t-1", submit: true, text: "fix bug" }；resolve {ok:true} 后清空。
// 3. Shift+Enter 不发送（保留换行）。
// 4. resolve { ok:false, error:"boom" } → toast.error（vi.mock("sonner")），内容保留。
// 5. 空输入按 ArrowDown → sendText 收到 { panelId:"t-1", text:"\u001b[B" }（无 submit）；
//    按 Escape → { text:"\u001b" }；输入非空后按 ArrowDown 不再透传。
// 6. focus 时 activeOverlayId === "terminal-composer:t-1"；卸载后回 null 且
//    onHeightChange 最后一次为 0。
// 7. IME 组合中（isComposing）Enter 不发送、Escape 不透传。
// 8. disabled=true 时 textarea 与发送键 disabled。
// afterEach: resetTerminalStoreForTests()。
```

Run: `pnpm vitest run tests/unit/renderer/terminal-composer.test.tsx` → FAIL。

- **Step 5: 实现组件**

`terminal-composer.tsx`：

```tsx
import { Button } from "@pier/ui/button.tsx";
import { CornerDownLeft } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  useTerminalOverlayFocus,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import { registerTerminalComposerTakeover } from "@/stores/terminal-composer-takeover.ts";
import { passthroughSequenceForKey } from "./terminal-composer-passthrough.ts";

/** 卡片与终端内容 / 状态栏之间的呼吸间距。 */
export const TERMINAL_COMPOSER_GAP_PX = 8;

interface TerminalComposerProps {
  bottomOffsetPx: number;
  disabled: boolean;
  onHeightChange: (heightPx: number) => void;
  panelId: string;
}

function reportSendFailure(t: (key: string) => string, detail: string): void {
  toast.error(t("terminal.composer.sendFailed"), { description: detail });
}

export function TerminalComposer({
  bottomOffsetPx,
  disabled,
  onHeightChange,
  panelId,
}: TerminalComposerProps) {
  const t = useT();
  const overlayId = `terminal-composer:${panelId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const activeOverlayId = useTerminalOverlayFocus(
    (state) => state.activeOverlayId
  );

  // 实测高度上报：field-sizing 自动增高经此驱动内容区 inset；卸载归零。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const report = () => {
      onHeightChange(root.getBoundingClientRect().height);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  // 接管注册：点击终端 / 激活面板时 workspace-host 经此把焦点重定向到输入框。
  useEffect(
    () =>
      registerTerminalComposerTakeover(panelId, () => {
        textareaRef.current?.focus();
      }),
    [panelId]
  );

  // 挂载即接管键盘（agent 态的主输入）；disabled 恢复时补聚焦。
  useEffect(() => {
    if (disabled) {
      return;
    }
    queueMicrotask(() => {
      textareaRef.current?.focus();
    });
  }, [disabled]);

  // 键盘被其它浮层（搜索栏/弹窗）拿走时 blur 保持视觉一致；卡片保持可见。
  useEffect(() => {
    if (activeOverlayId !== overlayId) {
      textareaRef.current?.blur();
    }
  }, [activeOverlayId, overlayId]);

  // 卸载让出键盘声明；归还终端焦点由面板层处理（agent 退出场景）。
  useEffect(
    () => () => {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    },
    [overlayId]
  );

  const sendRaw = (text: string) => {
    window.pier.terminal
      .sendText({ panelId, text })
      .then((result) => {
        if (!result.ok) {
          reportSendFailure(t, result.error ?? "");
        }
      })
      .catch((err: unknown) => {
        reportSendFailure(t, err instanceof Error ? err.message : String(err));
      });
  };

  const send = () => {
    const text = value;
    if (text.trim() === "" || disabled) {
      return;
    }
    window.pier.terminal
      .sendText({ panelId, submit: true, text })
      .then((result) => {
        if (result.ok) {
          setValue("");
          return;
        }
        reportSendFailure(t, result.error ?? "");
      })
      .catch((err: unknown) => {
        reportSendFailure(t, err instanceof Error ? err.message : String(err));
      });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const sequence = passthroughSequenceForKey({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      empty: value === "",
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (sequence !== null) {
      event.preventDefault();
      sendRaw(sequence);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div
      className="absolute inset-x-2 z-10"
      ref={rootRef}
      style={{ bottom: bottomOffsetPx + TERMINAL_COMPOSER_GAP_PX }}
    >
      <div
        aria-label={t("terminal.composer.label")}
        className="flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-background/40 shadow-lg focus-within:border-ring"
        data-testid="terminal-composer"
        role="group"
      >
        <textarea
          className="field-sizing-content max-h-48 min-h-9 w-full resize-none bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground/65"
          data-testid="terminal-composer-input"
          disabled={disabled}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={() => useTerminalStore.getState().activateOverlay(overlayId)}
          onKeyDown={onKeyDown}
          placeholder={t("terminal.composer.placeholder")}
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="flex h-8 items-center gap-1.5 px-1.5 pb-1">
          <span className="flex-1" />
          <span
            aria-hidden="true"
            className="text-[10px] text-muted-foreground/60"
          >
            {t("terminal.composer.keyHint")}
          </span>
          <Button
            aria-label={t("terminal.composer.send")}
            data-testid="terminal-composer-send"
            disabled={disabled || value.trim() === ""}
            onClick={send}
            size="icon-xs"
            type="button"
            variant={value.trim() === "" ? "ghost" : "default"}
          >
            <CornerDownLeft />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- **Step 6: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/terminal-composer.test.tsx tests/unit/renderer/terminal-composer-passthrough.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS。

- **Step 7: 提交检查点（需用户确认）**

```bash
git add src/renderer/panel-kits/terminal/terminal-composer.tsx src/renderer/panel-kits/terminal/terminal-composer-passthrough.ts src/renderer/i18n/locales/zh-CN/terminal.ts src/renderer/i18n/locales/en/terminal.ts tests/unit/renderer/terminal-composer.test.tsx tests/unit/renderer/terminal-composer-passthrough.test.ts
git diff --staged
# 拟用 message: feat(terminal): add agent composer card with control-key passthrough
```

---

### Task 4: 键盘接管注册表 + workspace-host 焦点重定向

**Files:**

- Create: `src/renderer/stores/terminal-composer-takeover.ts`
- Modify: `src/renderer/components/workspace/workspace-host.tsx`（两处：`handleActivePanelChange` 内 `requestTerminalFocusIntent(panel.id)` 约 88-93 行；`onFocusRequest` 处理器约 361-377 行）
- Test: `tests/unit/renderer/terminal-composer-takeover.test.ts`（新建）

**Interfaces:**

- Produces:
  - `registerTerminalComposerTakeover(panelId: string, focus: () => void): () => void`（同 panelId 重复注册以最新为准；返回 disposer 只清除自己这次注册）
  - `terminalComposerTakeoverFocus(panelId: string): boolean`（存在则调 focus 并返回 true）
  - `resetTerminalComposerTakeoverForTests(): void`
- Consumes: Task 3 组件在挂载时调用 register（若 Task 3 先行，本文件已按其 Step 说明建好，以先合入者为准）。
- **Step 1: 写失败的注册表测试**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerTerminalComposerTakeover,
  resetTerminalComposerTakeoverForTests,
  terminalComposerTakeoverFocus,
} from "../../../src/renderer/stores/terminal-composer-takeover.ts";

afterEach(() => {
  resetTerminalComposerTakeoverForTests();
});

describe("terminal composer takeover registry", () => {
  it("注册后 focus 被重定向并返回 true；无注册返回 false", () => {
    const focus = vi.fn();
    const dispose = registerTerminalComposerTakeover("t-1", focus);
    expect(terminalComposerTakeoverFocus("t-1")).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(terminalComposerTakeoverFocus("t-2")).toBe(false);
    dispose();
    expect(terminalComposerTakeoverFocus("t-1")).toBe(false);
  });

  it("重复注册以最新为准，旧 disposer 不误删新注册", () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = registerTerminalComposerTakeover("t-1", first);
    registerTerminalComposerTakeover("t-1", second);
    disposeFirst();
    expect(terminalComposerTakeoverFocus("t-1")).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm vitest run tests/unit/renderer/terminal-composer-takeover.test.ts` → FAIL。

- **Step 2: 实现注册表**

`src/renderer/stores/terminal-composer-takeover.ts`：

```ts
/**
 * Agent Composer 键盘接管注册表。composer 挂载时注册 focus 回调；
 * workspace-host 在「焦点归还终端」的两条路径上先询问这里——存在接管
 * 则聚焦 composer 输入框，不再把键盘交回 native 终端。
 */
const takeovers = new Map<string, () => void>();

export function registerTerminalComposerTakeover(
  panelId: string,
  focus: () => void
): () => void {
  takeovers.set(panelId, focus);
  return () => {
    if (takeovers.get(panelId) === focus) {
      takeovers.delete(panelId);
    }
  };
}

export function terminalComposerTakeoverFocus(panelId: string): boolean {
  const focus = takeovers.get(panelId);
  if (!focus) {
    return false;
  }
  focus();
  return true;
}

export function resetTerminalComposerTakeoverForTests(): void {
  takeovers.clear();
}
```

Run: `pnpm vitest run tests/unit/renderer/terminal-composer-takeover.test.ts` → PASS。

- **Step 3: workspace-host 两处 gate**

import `terminalComposerTakeoverFocus`。

约 88-93 行 `handleActivePanelChange`：

```tsx
  if (kind === "terminal") {
    if (!terminalComposerTakeoverFocus(panel.id)) {
      requestTerminalFocusIntent(panel.id);
    }
  } else {
    setTerminalBasePanel({ kind: "web" });
  }
```

约 361-377 行 `onFocusRequest`（点击终端内容的 native 焦点意图）：

```tsx
        if (result.ok) {
          // Agent Composer 接管期间：点击终端重定向聚焦输入卡片，键盘不回 native。
          if (terminalComposerTakeoverFocus(req.panelId)) {
            syncTerminalPresentation(event.api, "dockview-active-panel");
            return;
          }
          useTerminalStore.getState().yieldToTerminal();
          requestTerminalFocusIntent(req.panelId);
          syncTerminalPresentation(event.api, "dockview-active-panel");
        }
```

- **Step 4: 验证**

Run: `pnpm vitest run tests/unit/renderer/ && pnpm typecheck && pnpm lint && pnpm depcruise`
Expected: PASS（stores 被 workspace 与 panel-kits 双向消费是允许方向）。

- **Step 5: 提交检查点（需用户确认）**

```bash
git add src/renderer/stores/terminal-composer-takeover.ts src/renderer/components/workspace/workspace-host.tsx tests/unit/renderer/terminal-composer-takeover.test.ts
git diff --staged
# 拟用 message: feat(terminal): redirect terminal focus to agent composer via takeover registry
```

---

### Task 5: 面板接线——agent 态挂载 + 内容区 inset + 退出归还键盘

**Files:**

- Modify: `src/renderer/panel-kits/terminal/terminal-panel.tsx`（`activity` 已在 172 行订阅；`terminalContentClassName` 计算 373-375 行；`TerminalStatusBar` 挂载 450 行）
- Test: `tests/unit/renderer/terminal-composer-mount.test.ts`（新建，测挂载判定纯函数）
- Create: `src/renderer/panel-kits/terminal/terminal-composer-mount.ts`

**Interfaces:**

- Consumes: Task 2 `agentComposerEnabled`；Task 3 `TerminalComposer` / `TERMINAL_COMPOSER_GAP_PX`；`useForegroundActivityStore`（已有）；`requestTerminalFocusIntent`（`terminal-input-routing-slice.ts`）。
- Produces: `shouldMountAgentComposer(input: { activityKind: string | undefined; enabled: boolean; restored: boolean }): boolean`。
- **Step 1: 写失败的挂载判定测试**

`tests/unit/renderer/terminal-composer-mount.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { shouldMountAgentComposer } from "../../../src/renderer/panel-kits/terminal/terminal-composer-mount.ts";

describe("shouldMountAgentComposer", () => {
  it("仅在开关开启 + agent 活动 + 非恢复态面板时挂载", () => {
    expect(
      shouldMountAgentComposer({ activityKind: "agent", enabled: true, restored: false })
    ).toBe(true);
    expect(
      shouldMountAgentComposer({ activityKind: "shell", enabled: true, restored: false })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({ activityKind: undefined, enabled: true, restored: false })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({ activityKind: "agent", enabled: false, restored: false })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({ activityKind: "agent", enabled: true, restored: true })
    ).toBe(false);
  });
});
```

Run → FAIL。

- **Step 2: 实现挂载判定 + 面板接线**

`terminal-composer-mount.ts`：

```ts
/** F4 同款纪律：挂载判定单一实现，面板 inset 与组件渲染必须同口径。 */
export function shouldMountAgentComposer(input: {
  activityKind: string | undefined;
  enabled: boolean;
  restored: boolean;
}): boolean {
  return input.enabled && !input.restored && input.activityKind === "agent";
}
```

`terminal-panel.tsx` 改动点：

```tsx
// 1. imports：
import {
  TERMINAL_COMPOSER_GAP_PX,
  TerminalComposer,
} from "./terminal-composer.tsx";
import { shouldMountAgentComposer } from "./terminal-composer-mount.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { requestTerminalFocusIntent } from "@/stores/terminal-input-routing-slice.ts";

// 2. 组件体内（activity / hasStatusBar 计算之后）：
const agentComposerEnabled = useTerminalPreferencesStore(
  (s) => s.agentComposerEnabled
);
const composerMounted = shouldMountAgentComposer({
  activityKind: activity?.kind,
  enabled: agentComposerEnabled,
  restored: Boolean(restoredAgentResult || restoredTaskResult),
});
const [composerHeightPx, setComposerHeightPx] = useState(0);
const statusInsetPx = hasStatusBar ? 24 : 0; // 与原 bottom-6 等值
const terminalContentBottomPx =
  statusInsetPx +
  (composerMounted && composerHeightPx > 0
    ? composerHeightPx + TERMINAL_COMPOSER_GAP_PX * 2
    : 0);

// 3. agent 退出（挂载翻转 false）且本面板仍激活时，把键盘归还终端：
const prevComposerMountedRef = useRef(composerMounted);
useEffect(() => {
  if (prevComposerMountedRef.current && !composerMounted && api.isActive) {
    requestTerminalFocusIntent(panelId);
  }
  prevComposerMountedRef.current = composerMounted;
}, [composerMounted, api, panelId]);

// 4. 替换原 terminalContentClassName 两分支（373-375 行）：
const terminalContentClassName =
  "absolute inset-x-0 top-0 bottom-(--terminal-content-bottom)";

// 5. 根 div 加 style（className 不动）：
style={
  {
    "--terminal-content-bottom": `${terminalContentBottomPx}px`,
  } as React.CSSProperties
}

// 6. TerminalStatusBar 之前挂载：
{composerMounted ? (
  <TerminalComposer
    bottomOffsetPx={statusInsetPx}
    disabled={!nativeTerminalReady || Boolean(error)}
    onHeightChange={setComposerHeightPx}
    panelId={panelId}
  />
) : null}
```

说明：`terminal-panel-body.tsx` 无需修改；CSS 变量在根节点始终有值（无 Composer 无状态栏=0px ↔ 原 `inset-0`；仅状态栏=24px ↔ 原 `bottom-6`）。anchor 高度变化经现有 ResizeObserver → `setFrame` 同步 native。

- **Step 3: 验证**

Run: `pnpm vitest run tests/unit/renderer/ && pnpm typecheck && pnpm lint`
Expected: PASS。

手动（`pnpm dev`）：开终端 → 无 Composer；跑 `claude` → 卡片自动出现并聚焦；点击终端画面任意处 → 焦点仍回输入卡片（不进终端）；输入中文 prompt → Enter 提交给 claude；空输入按 ↑/↓/Enter → claude 菜单/历史响应；Esc → 打断生成；Ctrl+C 两次 → 退出 claude → 卡片消失、键盘回终端、内容区回落。

- **Step 4: 提交检查点（需用户确认）**

```bash
git add src/renderer/panel-kits/terminal/terminal-composer-mount.ts src/renderer/panel-kits/terminal/terminal-panel.tsx tests/unit/renderer/terminal-composer-mount.test.ts
git diff --staged
# 拟用 message: feat(terminal): mount agent composer on foreground agent activity
```

---

### Task 6: 智能体设置开关

**Files:**

- Modify: `src/renderer/pages/settings/components/agents-section.tsx`（在 section 顶部通用设置区添加 SwitchRow；如该 section 无通用开关区，放默认 agent 选择行之后）
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts` + `en/settings.ts`
- Test: `tests/unit/renderer/agents-section.test.tsx`（扩展现有测试文件）

**Interfaces:**

- Consumes: Task 2 `agentComposerEnabled` / `setAgentComposerEnabled`。
- **Step 1: i18n key（zh-CN + en）**

`zh-CN/settings.ts`（`row` 命名空间，与其它 agent 行相邻）：

```ts
  agentComposer: "智能体输入框",
  agentComposerDesc:
    "检测到智能体会话时，在终端底部显示专用输入框：标准输入法体验，Enter 直接发送给智能体。",
```

`en/settings.ts`：

```ts
  agentComposer: "Agent composer",
  agentComposerDesc:
    "When an agent session is detected, show a dedicated input box at the bottom of the terminal: native IME editing, Enter sends straight to the agent.",
```

- **Step 2: 写失败的测试**

在 `tests/unit/renderer/agents-section.test.tsx` 中按其现有 render 脚手架添加：

```tsx
// 1. 渲染 AgentsSection，断言存在 id "settings-agent-composer" 的 switch，默认 checked。
// 2. 点击 → mock window.pier.preferences.update 收到 { agentComposerEnabled: false }。
```

Run: `pnpm vitest run tests/unit/renderer/agents-section.test.tsx` → FAIL。

- **Step 3: 实现 SwitchRow**

`agents-section.tsx`（selector/setter 从 `useTerminalPreferencesStore` 取，import 对齐同文件风格）：

```tsx
              <SwitchRow
                checked={agentComposerEnabled}
                description={t("settings.row.agentComposerDesc")}
                id="settings-agent-composer"
                label={t("settings.row.agentComposer")}
                onCheckedChange={(next) => {
                  setAgentComposerEnabled(next).catch(() => undefined);
                }}
              />
```

（若该 section 尚未 import `SwitchRow`，从 `@/pages/settings/components/rows/switch-row.tsx` 引入；位置与周边 `FieldSeparator` 节奏一致。）

- **Step 4: 跑测试确认通过 + 手动验证**

Run: `pnpm vitest run tests/unit/renderer/agents-section.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS。

手动：设置 → 智能体 → 关闭「智能体输入框」→ 正在跑 agent 的面板 Composer 即时卸载、键盘回终端；开启 → 恢复。

- **Step 5: 提交检查点（需用户确认）**

```bash
git add src/renderer/pages/settings/components/agents-section.tsx src/renderer/i18n/locales/zh-CN/settings.ts src/renderer/i18n/locales/en/settings.ts tests/unit/renderer/agents-section.test.tsx
git diff --staged
# 拟用 message: feat(settings): add agent composer switch to agents section
```

---

### Task 7: V0 闭环验收——e2e + 全量检查

**Files:**

- Create: `tests/e2e/agent-composer.spec.ts`（harness 照 `tests/e2e/terminal-overlay-coexistence.spec.ts`：`OUT_MAIN` / `readSnapshot` / `webRequestCount` / `waitForTerminalCount` / `readTerminalPanelId` / `simulateTerminalFocusIntent` 原样复制）

**Interfaces:**

- Consumes: 前六个任务全部产物；foreground-activity 广播通道（实现前先读 `src/shared/contracts/foreground-activity.ts` 的 `ForegroundActivityBroadcast` 与 renderer store 订阅的确切通道名，按契约构造注入 payload）。
- **Step 1: 实现 e2e spec**

CI 无真实 agent 可跑，用「main 进程补发 foreground-activity 广播」模拟 agent 态（同 `simulateTerminalFocusIntent` 的注入思路）：

```ts
// helper: broadcastAgentActivity(app, panelId, kind)
//   app.evaluate(({ webContents }, { panelId, kind, ts }) => { ... send 广播通道
//     { activities: [kind === "agent" ? { kind:"agent", panelId, windowId:"1",
//       agentId:"claude", source:"launch", subagentCount:0,
//       spawnedAt:ts, updatedAt:ts } : { kind:"idle", panelId, windowId:"1",
//       spawnedAt:ts, updatedAt:ts }], ts } , panelId)
//   ts 用递增计数保证 store 单调守卫通过；字段以契约 schema 为准。
//
// test 1: "composer mounts on agent activity and takes keyboard ownership"
//  1. launch → waitForTerminalCount(win,1) → panelId
//  2. 断言初始无 '[data-testid="terminal-composer"]'
//  3. broadcastAgentActivity(app, panelId, "agent") → composer attached
//  4. expect.poll(webRequestCount) >= 1（挂载 auto-focus 即接管）
//  5. simulateTerminalFocusIntent(app, panelId) →
//     expect.poll(webRequestCount) 仍 >= 1（点击被重定向，键盘不回终端）
//  6. input.fill("echo pier-agent-composer") → press("Enter") →
//     expect.poll(() => input.inputValue()) === ""
//  7. broadcastAgentActivity(app, panelId, "idle") → composer detached；
//     expect.poll(webRequestCount) === 0（键盘归还终端）
//
// test 2: "sendText round-trips through main into the pty"（与终端无 UI 依赖）
//  1. launch → panelId
//  2. win.evaluate sendText({ panelId, submit:true, text:"echo e2e-ok" }) →
//     expect result.ok === true
//  3. 负例 panelId "no-such-panel" → result.ok === false
```

- **Step 2: 跑 e2e**

Run: `pnpm build && pnpm test:e2e -- agent-composer.spec.ts`
Expected: PASS（macOS；无 native 环境 skip）。

- **Step 3: 全量检查**

Run: `pnpm check`
Expected: typecheck + lint + depcruise + file-size + unit + component 全绿；`terminal-panel.tsx` 若触发 file-size 守卫，把 composer 相关计算抽到 `terminal-composer-mount.ts` 扩展。

- **Step 4: 手动验收清单**

1. `pnpm dev` → 普通终端无 Composer；跑 `claude` → 底部浮动卡片自动出现并聚焦。
2. 中文长 prompt（Chromium IME，无终端 preedit）→ Enter → claude 收到并开始处理。
3. 生成中按 Esc → 打断；空输入 ↑/↓ + Enter → 菜单/历史选择可用；Shift+Tab → 模式切换。
4. 点击终端画面 → 焦点回输入卡片（键盘不进终端）；鼠标拖选终端文本 + 右键复制仍可用。
5. 多行输入自动增高、上限内滚；发送键随内容 ghost ↔ 实心。
6. 退出 claude → 卡片消失、键盘回终端可直接打字、内容区回落。
7. 设置 → 智能体 → 开关即时生效（跨窗口广播）。

- **Step 5: 提交检查点（需用户确认）**

```bash
git add tests/e2e/agent-composer.spec.ts
git diff --staged
# 拟用 message: test(terminal): add agent composer e2e coverage
```

---

## Self-Review 记录

- **v4 需求核对**：①开关在智能体设置（Task 6，`agents-section.tsx`）且仅 agent TUI 展示（Task 5 `shouldMountAgentComposer`）；②直接展示输入框（无折叠/toggle，Task 3 组件只有展开态）；③终端不再接输入——点击重定向聚焦 composer（Task 4 takeover gate）+ 控制键透传（Task 3 passthrough）+ Enter 直接发送（Task 1/3）。
- **类型一致性**：`TerminalSendTextArgs`/`sendText`（Task 1 定义，Task 3/7 消费）；`registerTerminalComposerTakeover`/`terminalComposerTakeoverFocus`（Task 4 定义，Task 3 组件 / workspace-host 消费）；`TERMINAL_COMPOSER_GAP_PX`、`onHeightChange`（Task 3 定义，Task 5 消费）；`agentComposerEnabled`（Task 2 定义，Task 5/6 消费）；`shouldMountAgentComposer`（Task 5 定义与消费）。
- **删除项核对**：折叠态 / panel params / Cmd+I / `APP_HANDLED_NATIVE_TERMINAL_COMMANDS` / 右键 action / 终端 section 开关——v4 全部移除，不再出现在任何任务中。
- **已知留白（有意）**：组件/settings 测试 render 脚手架以先例文件为准；e2e 广播 payload 以 `foreground-activity.ts` 契约 schema 为准（字段名已按当前契约写出，实现时校验）。

