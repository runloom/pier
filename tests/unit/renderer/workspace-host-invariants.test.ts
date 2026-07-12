import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * workspace-host 内几条关键不变量, 源文件层 lock 防回归. 这些 invariant 跟 dockview
 * 行为强耦合, 用 unit test 行为模拟成本高且脆 (要造完整 dockview API mock), 用 source
 * grep 锁定关键 guard / 顺序更稳.
 */
const PATH = resolve(
  import.meta.dirname,
  "../../../src/renderer/components/workspace/workspace-host.tsx"
);
const SOURCE = readFileSync(PATH, "utf8");
const RENDERER_MAIN_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/renderer/main.tsx"),
  "utf8"
);
const LIFECYCLE_SOURCE = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../src/renderer/components/workspace/workspace-lifecycle-commands.ts"
  ),
  "utf8"
);

const USER_TOUCHED_FLAG_RE = /let userTouched = false/;
const USER_TOUCHED_SET_TRUE_RE = /userTouched = true/;
const USER_TOUCHED_GUARDS_FROMJSON_RE =
  /if \(userTouched\) \{[\s\S]{0,200}?\/\/[\s\S]{0,100}?\n\s*return;\s*\}/;

const IS_APPLYING_PERSISTED_DECL_RE = /let isApplyingPersistedLayout = false/;
const IS_APPLYING_GUARDS_SAVE_RE = /if \(isApplyingPersistedLayout\) \{/;

const ACTIVE_PANEL_CHANGE_HANDLES_NULL_RE =
  /function syncActivePanelScope\(panel: WorkspacePanel \| null \| undefined\): void \{[\s\S]{0,200}?if \(!panel\) \{/;
const ACTIVE_PANEL_CHANGE_USES_SCOPE_HELPER_RE =
  /const handleActivePanelChange:[\s\S]{0,200}?= \(change\) => \{[\s\S]{0,1200}?const panel = change\.panel;[\s\S]{0,1200}?syncActivePanelScope\(panel\)/;
const ACTIVE_PANEL_CHANGE_REQUESTS_PRESENTATION_RE =
  /const handleActivePanelChange:[\s\S]{0,200}?= \(change\) => \{[\s\S]{0,1400}?syncTerminalPresentation\(event\.api, "dockview-active-panel"\)/;
const ACTIVE_PANEL_CHANGE_SETS_INPUT_ROUTING_RE =
  /function syncActivePanelScope\(panel: WorkspacePanel \| null \| undefined\): void \{[\s\S]{0,900}?setTerminalBasePanel/;
const OLD_ACTIVE_PANEL_PRIMITIVE_RE = new RegExp(
  [String.raw`window\.pier\?\.terminal\?\.set`, "ActivePanelKind"].join("")
);

const RECONCILE_CALL_RE =
  /window\.pier\?\.terminal\?\.reconcile\?\.\(terminalPanelIds\)/;
const READS_WINDOW_CONTEXT_RE = /window\.pier\.window\.getContext\(\)/;
const SAVES_LAYOUT_BY_WINDOW_RECORD_RE =
  /const windowContext = await windowContextPromise[\s\S]{0,500}?\.saveLayout\(\s*json,\s*windowContext\.recordId\s*\)/;
const LOADS_LAYOUT_BY_WINDOW_RECORD_RE =
  /window\.pier\.workspace\.loadLayout\(\s*windowContext\.recordId\s*\)/;
const FRESH_MODE_SKIP_RE = /windowContext\.mode !== "fresh"/;
const FLUSH_LAYOUT_COMMAND_RE =
  /envelope\.command\.type === "workspace\.flushLayout"/;
const FLUSH_SAVES_CURRENT_LAYOUT_RE =
  /window\.pier\.workspace[\s\S]{0,80}?\.saveLayout\(\s*event\.api\.toJSON\(\),\s*windowContext\.recordId\s*\)/;
const WRITABLE_MAIN_FALLBACK_RE = /recordId: "main"/;
const WINDOW_CONTEXT_PROMISE_RE =
  /const windowContextPromise = window\.pier\.window\.getContext\(\)/;
const AWAITS_WINDOW_CONTEXT_FOR_SAVE_RE =
  /const windowContext = await windowContextPromise[\s\S]{0,500}?\.saveLayout\(\s*json,\s*windowContext\.recordId\s*\)/;
const FLUSH_EMPTY_LAYOUT_CLEARS_RECORD_RE =
  /if \(event\.api\.totalPanels === 0\)[\s\S]{0,160}?\.clearLayout\(windowContext\.recordId\)/;
const WORKSPACE_READY_AFTER_LAYOUT_RE =
  /reconcileTerminalPanels\(event\.api\);\s*notifyWorkspaceReady\(\);/;
const WORKSPACE_READY_WHEN_USER_TOUCHED_RE =
  /if \(userTouched\) \{[\s\S]{0,120}?notifyWorkspaceReady\(\);[\s\S]{0,80}?return;/;
const BOOT_SIGNAL_AFTER_COMPONENT_MOUNT_RE =
  /function RendererBootSignal\(\)[\s\S]{0,180}?useEffect\(\(\) => \{\s*window\.pier\?\.window\?\.readyToShow\?\.\(\)/;
const FINAL_APP_RETAINS_BOOT_SIGNAL_RE =
  /root\.render\(\s*<>\s*<RendererBootSignal key="application" \/>\s*<App \/>/;

describe("workspace-host invariants (#17 #19)", () => {
  it("declares userTouched flag and uses it to gate fromJSON (防 user 操作被 saved layout 覆盖)", () => {
    // #19 layout 恢复 race:user 在 loadLayout pending 期间手动按 Cmd+T / 拖 panel 等,
    // userTouched = true. loadLayout 完成时如果 user 已操作, fromJSON 跳过.
    expect(SOURCE).toMatch(USER_TOUCHED_FLAG_RE);
    expect(SOURCE).toMatch(USER_TOUCHED_SET_TRUE_RE);
    expect(SOURCE).toMatch(USER_TOUCHED_GUARDS_FROMJSON_RE);
  });

  it("declares isApplyingPersistedLayout flag and uses it to gate save", () => {
    // 防 save-loop:fromJSON / 默认 layout 应用期间 onDidLayoutChange 触发的 change
    // 是 program-driven, 不该 save (会 round-trip 存"恢复出来的"同样内容).
    expect(SOURCE).toMatch(IS_APPLYING_PERSISTED_DECL_RE);
    expect(SOURCE).toMatch(IS_APPLYING_GUARDS_SAVE_RE);
  });

  it("onDidActivePanelChange handles null panel via scope + presentation sync", () => {
    // active panel 可能为 null. renderer 只同步 keybinding scope + desired
    // presentation, 不再直接写 native primitive.
    expect(SOURCE).toMatch(ACTIVE_PANEL_CHANGE_HANDLES_NULL_RE);
    expect(SOURCE).toMatch(ACTIVE_PANEL_CHANGE_USES_SCOPE_HELPER_RE);
    expect(SOURCE).toMatch(ACTIVE_PANEL_CHANGE_REQUESTS_PRESENTATION_RE);
  });

  it("routes active panel keyboard ownership through the input routing coordinator", () => {
    // renderer 只更新输入路由目标; native first responder 由 main 校验后统一落地.
    expect(SOURCE).toMatch(ACTIVE_PANEL_CHANGE_SETS_INPUT_ROUTING_RE);
    expect(SOURCE).not.toMatch(OLD_ACTIVE_PANEL_PRIMITIVE_RE);
  });

  it("calls reconcile after layout restore to clean up orphan native NSViews", () => {
    // C 方案 reload 零销毁:layout 应用后报告"我现在还需要这些 panelId", swift 把
    // 不在集合的孤儿清掉. 缺这条 reload 后旧 NSView 永久挂在 contentView.subviews.
    expect(SOURCE).toMatch(RECONCILE_CALL_RE);
  });

  it("loads persisted layout from the current durable window record", () => {
    // Cmd+N 是新建新 record, 所以首次自然为空; 同一 record 后续 reload / restore
    // 仍必须能读回自己的 layout, 不能用 fresh mode 永久跳过恢复.
    expect(SOURCE).toMatch(READS_WINDOW_CONTEXT_RE);
    expect(SOURCE).toMatch(LOADS_LAYOUT_BY_WINDOW_RECORD_RE);
    expect(SOURCE).not.toMatch(FRESH_MODE_SKIP_RE);
  });

  it("persists and restores layouts by durable window record", () => {
    // 新窗口不继承旧窗口, 但它自己的 layout 仍要能在 Cmd+Q 或重新激活后恢复.
    // 因此读写都必须带 window record scope, 不能再写全局 workspace-layout.json.
    expect(SOURCE).toMatch(SAVES_LAYOUT_BY_WINDOW_RECORD_RE);
    expect(SOURCE).toMatch(LOADS_LAYOUT_BY_WINDOW_RECORD_RE);
  });

  it("does not use main as a writable fallback before window context resolves", () => {
    // 二号窗口刚 ready 但 getWindowContext 尚未返回时, close/Cmd+Q flush
    // 不能把该窗口布局写进 main record.
    expect(SOURCE).toMatch(WINDOW_CONTEXT_PROMISE_RE);
    expect(SOURCE).toMatch(AWAITS_WINDOW_CONTEXT_FOR_SAVE_RE);
    expect(SOURCE).not.toMatch(WRITABLE_MAIN_FALLBACK_RE);
  });

  it("handles renderer flushLayout command by saving the current dockview layout", () => {
    // window close / Cmd+Q 不能等 debounced save, main 会请求 renderer 立刻把
    // 当前 dockview 布局写入当前 window record.
    expect(LIFECYCLE_SOURCE).toMatch(FLUSH_LAYOUT_COMMAND_RE);
    expect(SOURCE).toMatch(FLUSH_SAVES_CURRENT_LAYOUT_RE);
  });

  it("keeps closeAll from re-saving an empty dockview layout", () => {
    // closeAll 会先清 record layout 再关闭窗口; close-before-flush 看到 0 panels
    // 时必须保持 cleared state, 不能把空 dockview JSON 写回 record.
    expect(SOURCE).toMatch(FLUSH_EMPTY_LAYOUT_CLEARS_RECORD_RE);
  });

  it("separates the visible startup shell from workspace readiness", () => {
    // 启动壳挂载即可显示窗口；布局恢复只更新 workspace ready 状态，慢初始化不应
    // 被 main 的 renderer boot watchdog 当成致命失败。
    expect(RENDERER_MAIN_SOURCE).toMatch(BOOT_SIGNAL_AFTER_COMPONENT_MOUNT_RE);
    expect(RENDERER_MAIN_SOURCE).toMatch(FINAL_APP_RETAINS_BOOT_SIGNAL_RE);
    expect(SOURCE).toMatch(WORKSPACE_READY_AFTER_LAYOUT_RE);
    expect(SOURCE).toMatch(WORKSPACE_READY_WHEN_USER_TOUCHED_RE);
    expect(SOURCE).not.toContain("readyToShow");
  });
});
