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

const USER_TOUCHED_FLAG_RE = /let userTouched = false/;
const USER_TOUCHED_SET_TRUE_RE = /userTouched = true/;
const USER_TOUCHED_GUARDS_FROMJSON_RE =
  /if \(userTouched\) \{[\s\S]{0,200}?\/\/[\s\S]{0,100}?\n\s*return;\s*\}/;

const IS_APPLYING_PERSISTED_DECL_RE = /let isApplyingPersistedLayout = false/;
const IS_APPLYING_GUARDS_SAVE_RE = /if \(isApplyingPersistedLayout\) \{/;

const ACTIVE_PANEL_CHANGE_HANDLES_NULL_RE =
  /function syncActivePanelScope\(panel: WorkspacePanel \| null \| undefined\): void \{[\s\S]{0,200}?if \(!panel\) \{/;
const ACTIVE_PANEL_CHANGE_USES_SCOPE_HELPER_RE =
  /event\.api\.onDidActivePanelChange\(\(panel\) => \{[\s\S]{0,1200}?syncActivePanelScope\(panel\)/;
const ACTIVE_PANEL_CHANGE_REQUESTS_PRESENTATION_RE =
  /event\.api\.onDidActivePanelChange\(\(panel\) => \{[\s\S]{0,1400}?syncTerminalPresentation\(event\.api, "dockview-active-panel"\)/;

const SET_ACTIVE_PANEL_KIND_PRIMITIVE_RE =
  /window\.pier\?\.terminal\?\.setActivePanelKind/;

const RECONCILE_CALL_RE =
  /window\.pier\?\.terminal\?\.reconcile\?\.\(terminalPanelIds\)/;
const READS_WINDOW_CONTEXT_RE = /window\.pier\.getWindowContext\(\)/;
const SAVES_LAYOUT_BY_WINDOW_RECORD_RE =
  /const windowContext = await windowContextPromise[\s\S]{0,500}?\.saveLayout\(\s*json,\s*windowContext\.recordId\s*\)/;
const LOADS_LAYOUT_BY_WINDOW_RECORD_RE =
  /window\.pier\.workspace\.loadLayout\(\s*windowContext\.recordId\s*\)/;
const FRESH_MODE_SKIP_RE = /windowContext\.mode !== "fresh"/;
const FLUSH_LAYOUT_COMMAND_RE = /case "workspace\.flushLayout"/;
const FLUSH_SAVES_CURRENT_LAYOUT_RE =
  /window\.pier\.workspace[\s\S]{0,80}?\.saveLayout\(\s*event\.api\.toJSON\(\),\s*windowContext\.recordId\s*\)/;
const WRITABLE_MAIN_FALLBACK_RE = /recordId: "main"/;
const WINDOW_CONTEXT_PROMISE_RE =
  /const windowContextPromise = window\.pier\.getWindowContext\(\)/;
const AWAITS_WINDOW_CONTEXT_FOR_SAVE_RE =
  /const windowContext = await windowContextPromise[\s\S]{0,500}?\.saveLayout\(\s*json,\s*windowContext\.recordId\s*\)/;
const FLUSH_EMPTY_LAYOUT_CLEARS_RECORD_RE =
  /if \(event\.api\.totalPanels === 0\)[\s\S]{0,160}?\.clearLayout\(windowContext\.recordId\)/;
const READY_TO_SHOW_AFTER_LAYOUT_RE =
  /window\.pier\?\.terminal\?\.reconcile\?\.\(terminalPanelIds\);\s*notifyReadyToShow\(\);/;
const READY_TO_SHOW_WHEN_USER_TOUCHED_RE =
  /if \(userTouched\) \{[\s\S]{0,120}?notifyReadyToShow\(\);[\s\S]{0,80}?return;/;
const READY_TO_SHOW_USES_HIDDEN_WINDOW_SAFE_TIMER_RE =
  /setTimeout\(\(\) => \{[\s\S]{0,80}?window\.pier\.readyToShow\(\);[\s\S]{0,40}?\}, 0\)/;
const READY_TO_SHOW_DOES_NOT_WAIT_FOR_RAF_RE =
  /requestAnimationFrame\([\s\S]{0,160}?window\.pier\.readyToShow\(\)/;

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

  it("does not call native active-panel primitive from renderer workspace host", () => {
    // presentation reconciler 是 renderer presentation 唯一写入口.
    expect(SOURCE).not.toMatch(SET_ACTIVE_PANEL_KIND_PRIMITIVE_RE);
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
    expect(SOURCE).toMatch(FLUSH_LAYOUT_COMMAND_RE);
    expect(SOURCE).toMatch(FLUSH_SAVES_CURRENT_LAYOUT_RE);
  });

  it("keeps closeAll from re-saving an empty dockview layout", () => {
    // closeAll 会先清 record layout 再关闭窗口; close-before-flush 看到 0 panels
    // 时必须保持 cleared state, 不能把空 dockview JSON 写回 record.
    expect(SOURCE).toMatch(FLUSH_EMPTY_LAYOUT_CLEARS_RECORD_RE);
  });

  it("notifies main after workspace layout has reached a stable first paint point", () => {
    // main 侧等 readyToShow 再展示窗口, 避免 did-finish-load 后把 theme/layout/terminal
    // 恢复中的中间态暴露给用户.
    expect(SOURCE).toMatch(READY_TO_SHOW_AFTER_LAYOUT_RE);
    expect(SOURCE).toMatch(READY_TO_SHOW_WHEN_USER_TOUCHED_RE);
    expect(SOURCE).toMatch(READY_TO_SHOW_USES_HIDDEN_WINDOW_SAFE_TIMER_RE);
    expect(SOURCE).not.toMatch(READY_TO_SHOW_DOES_NOT_WAIT_FOR_RAF_RE);
  });
});
