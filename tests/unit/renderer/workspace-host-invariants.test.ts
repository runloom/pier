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
  /event\.api\.onDidActivePanelChange\(\(panel\) => \{[\s\S]{0,800}?if \(!panel\) \{/;

const SET_ACTIVE_PANEL_KIND_FOR_TERMINAL_RE =
  /window\.pier\?\.terminal\?\.setActivePanelKind\?\.\(kind, panel\.id\)/;
const SET_ACTIVE_PANEL_KIND_FOR_WEB_NULL_RE =
  /window\.pier\?\.terminal\?\.setActivePanelKind\?\.\("web", null\)/;

const RECONCILE_CALL_RE =
  /window\.pier\?\.terminal\?\.reconcile\?\.\(terminalPanelIds\)/;

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

  it("onDidActivePanelChange handles null panel by setting web kind (no terminal steals)", () => {
    // #17 fromJSON 失败 / no panels:active panel 可能为 null, 必须 fallback 到
    // setActivePanelKind("web", null), 防止 swift 拿着旧 stale panelId 继续 makeFirstResponder.
    expect(SOURCE).toMatch(ACTIVE_PANEL_CHANGE_HANDLES_NULL_RE);
    expect(SOURCE).toMatch(SET_ACTIVE_PANEL_KIND_FOR_WEB_NULL_RE);
  });

  it("forwards active panel + kind to swift on every onDidActivePanelChange", () => {
    // 这是切 tab / drag / 任何 dockview activePanel 变化的核心 IPC 边界. 缺这条
    // swift 端永远停在旧 active panel, 切 tab 视觉跟输入都漂.
    expect(SOURCE).toMatch(SET_ACTIVE_PANEL_KIND_FOR_TERMINAL_RE);
  });

  it("calls reconcile after layout restore to clean up orphan native NSViews", () => {
    // C 方案 reload 零销毁:layout 应用后报告"我现在还需要这些 panelId", swift 把
    // 不在集合的孤儿清掉. 缺这条 reload 后旧 NSView 永久挂在 contentView.subviews.
    expect(SOURCE).toMatch(RECONCILE_CALL_RE);
  });
});
