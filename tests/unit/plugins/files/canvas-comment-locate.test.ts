import { locateCanvasCommentPins } from "@plugins/builtin/files/renderer/preview/canvas-comment-locate.ts";
import { snapshotCanvasElementPick } from "@plugins/builtin/files/renderer/preview/canvas-element-pick.ts";
import { isCanvasCommentTargetVisible } from "@plugins/builtin/files/renderer/preview/canvas-pick-shared.ts";
import type { CanvasSoftMarker } from "@plugins/builtin/files/renderer/preview/canvas-soft-markers.ts";
import type { CanvasCommentThreadView } from "@plugins/builtin/files/renderer/preview/use-canvas-preview-comments.ts";
import { CANVAS_COMMENT_ANCHOR_ATTR } from "@shared/comments/canvas-anchor.ts";
import { describe, expect, it } from "vitest";

function thread(
  id: string,
  createdAt: number,
  label?: string
): CanvasCommentThreadView {
  return {
    comment: {
      authorLabel: "You",
      body: `note ${id}`,
      createdAt,
      id: `c-${id}`,
    },
    threadId: id,
    ...(label === undefined ? {} : { label }),
  };
}

function locate(input: {
  readonly host: HTMLElement;
  readonly locatedByAnchorId?: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickedNodeThreads?: readonly CanvasCommentThreadView[];
  readonly softMarkers?: readonly CanvasSoftMarker[];
}) {
  return locateCanvasCommentPins({
    host: input.host,
    locatedByAnchorId: input.locatedByAnchorId ?? new Map(),
    pickedNodeThreads: input.pickedNodeThreads ?? [],
    shell: input.host,
    softMarkers: input.softMarkers ?? [],
  });
}

describe("isCanvasCommentTargetVisible", () => {
  it("hides targets inside an inactive tab panel only", () => {
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("data-state", "inactive");
    panel.setAttribute("hidden", "");
    const inner = document.createElement("p");
    panel.append(inner);
    expect(isCanvasCommentTargetVisible(inner)).toBe(false);

    panel.setAttribute("data-state", "active");
    panel.removeAttribute("hidden");
    expect(isCanvasCommentTargetVisible(inner)).toBe(true);

    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "tabs-trigger");
    trigger.setAttribute("data-state", "inactive");
    expect(isCanvasCommentTargetVisible(trigger)).toBe(true);
  });
});

describe("locateCanvasCommentPins", () => {
  it("numbers pins by created time so a new comment increments", () => {
    const host = document.createElement("div");
    const newer = document.createElement("div");
    newer.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "new");
    const older = document.createElement("div");
    older.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "old");
    host.append(newer, older);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([
        ["new", [thread("new", 200)]],
        ["old", [thread("old", 100)]],
      ]),
    });
    expect(located.pins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-old", 1],
      ["anchor-new", 2],
    ]);
    host.remove();
  });

  it("does not paint pins inside an inactive tab panel", () => {
    const host = document.createElement("div");
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("data-state", "inactive");
    panel.setAttribute("hidden", "");
    const target = document.createElement("div");
    target.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "card");
    panel.append(target);
    host.append(panel);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([["card", [thread("card", 1)]]]),
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    expect(located.hiddenPins[0]?.key).toBe("anchor-card");
    expect(located.hiddenPins[0]?.index).toBe(1);
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("still paints pins in the active tab panel", () => {
    const host = document.createElement("div");
    const active = document.createElement("div");
    active.setAttribute("data-slot", "tabs-content");
    active.setAttribute("data-state", "active");
    const target = document.createElement("div");
    target.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "card");
    active.append(target);
    const inactive = document.createElement("div");
    inactive.setAttribute("data-slot", "tabs-content");
    inactive.setAttribute("data-state", "inactive");
    inactive.setAttribute("hidden", "");
    host.append(active, inactive);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([["card", [thread("card", 1)]]]),
    });
    expect(located.pins).toHaveLength(1);
    expect(located.pins[0]?.key).toBe("anchor-card");
    host.remove();
  });

  it("keeps global indexes when a later comment is on another tab", () => {
    const host = document.createElement("div");
    const active = document.createElement("div");
    active.setAttribute("data-slot", "tabs-content");
    active.setAttribute("data-state", "active");
    const older = document.createElement("div");
    older.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "old");
    const newer = document.createElement("div");
    newer.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "new");
    active.append(older, newer);
    const inactive = document.createElement("div");
    inactive.setAttribute("data-slot", "tabs-content");
    inactive.setAttribute("data-state", "inactive");
    inactive.setAttribute("hidden", "");
    const mid = document.createElement("div");
    mid.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "mid");
    inactive.append(mid);
    host.append(active, inactive);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([
        ["old", [thread("old", 100)]],
        ["mid", [thread("mid", 150)]],
        ["new", [thread("new", 200)]],
      ]),
    });
    expect(located.pins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-old", 1],
      ["anchor-new", 3],
    ]);
    expect(located.hiddenPins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-mid", 2],
    ]);
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("parks a picked comment on an inactive tab as a hidden pin", () => {
    const host = document.createElement("div");
    const inactive = document.createElement("div");
    inactive.setAttribute("data-slot", "tabs-content");
    inactive.setAttribute("data-state", "inactive");
    inactive.setAttribute("hidden", "");
    const target = document.createElement("p");
    target.textContent = "UniqueHeroCopy";
    inactive.append(target);
    host.append(inactive);
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [thread("hero", 1, "UniqueHeroCopy")],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    expect(located.hiddenPins[0]?.key).toBe("label:uniqueherocopy");
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("collapses comments on the same node into one numbered pin", () => {
    const host = document.createElement("div");
    const tab = document.createElement("button");
    tab.textContent = "设计";
    host.append(tab);
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [
        thread("first", 100, "设计"),
        thread("second", 200, "设计"),
      ],
    });
    expect(located.pins).toHaveLength(1);
    expect(located.pins[0]?.key).toBe("label:设计");
    expect(located.pins[0]?.index).toBe(1);
    expect(located.pins[0]?.threads.map((entry) => entry.threadId)).toEqual([
      "first",
      "second",
    ]);
    host.remove();
  });

  it("keeps same-label comments as one pin when the node is not in the host", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [
        thread("first", 100, "设计"),
        thread("second", 200, "设计"),
      ],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    expect(located.hiddenPins[0]?.key).toBe("label:设计");
    expect(located.hiddenPins[0]?.index).toBe(1);
    expect(
      located.hiddenPins[0]?.threads.map((entry) => entry.threadId)
    ).toEqual(["first", "second"]);
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("counts a picked comment with no live element in n/N", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [thread("away", 1, "落地")],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins.map((pin) => [pin.key, pin.index])).toEqual([
      ["label:落地", 1],
    ]);
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("keeps global indexes when a later comment's target is unmounted", () => {
    const host = document.createElement("div");
    const older = document.createElement("div");
    older.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "old");
    host.append(older);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([
        ["old", [thread("old", 100)]],
        ["away", [thread("away", 200)]],
      ]),
    });
    expect(located.pins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-old", 1],
    ]);
    expect(located.hiddenPins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-away", 2],
    ]);
    expect(located.driftThreads).toEqual([]);
    host.remove();
  });

  it("paints a pin on an Alert for a truncated long label", () => {
    const host = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert");
    alert.setAttribute("role", "alert");
    const title = document.createElement("div");
    title.setAttribute("data-slot", "alert-title");
    title.textContent = "物料在 SDK 里，不在人眼前";
    const description = document.createElement("div");
    description.setAttribute("data-slot", "alert-description");
    description.textContent =
      "生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useCanvasFile，但设置里只有预览根目录卡。上一版把看见面做成顶栏新区、三家族分页面廊和并排 Kit，发现模型仍与技能库脱节。";
    alert.append(title, description);
    host.append(alert);
    document.body.append(host);

    const label = snapshotCanvasElementPick(host, alert).label;
    const located = locate({
      host,
      pickedNodeThreads: [thread("alert", 1, label)],
    });
    expect(located.hiddenPins).toEqual([]);
    expect(located.pins).toHaveLength(1);
    expect(located.pins[0]?.key.startsWith("label:")).toBe(true);
    host.remove();
  });

  it("does not rematch a truncated label onto a shared title prefix", () => {
    const host = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert");
    alert.setAttribute("role", "alert");
    const title = document.createElement("div");
    title.setAttribute("data-slot", "alert-title");
    title.textContent = "物料在 SDK";
    alert.append(title);
    host.append(alert);
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [
        thread(
          "other-tab",
          1,
          "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useC…"
        ),
      ],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    host.remove();
  });

  it("does not paint another tab's pin at stale soft-marker coordinates", () => {
    const host = document.createElement("div");
    const alert = document.createElement("div");
    alert.setAttribute("data-slot", "alert");
    alert.setAttribute("role", "alert");
    alert.textContent = "研究收敛 共同结论：一次性用原生 agent。";
    host.append(alert);
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [
        thread(
          "other-tab",
          1,
          "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useC…"
        ),
      ],
      softMarkers: [
        {
          label:
            "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。pier/canvas 已有约 150 个 UI 导出和 useC…",
          left: 640,
          threadId: "other-tab",
          top: 96,
        },
      ],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    expect(located.hiddenPins[0]?.key.startsWith("label:")).toBe(true);
    host.remove();
  });

  it("keeps a hidden-tab alert pin hidden when another alert is on screen", () => {
    const host = document.createElement("div");
    const active = document.createElement("div");
    active.setAttribute("data-slot", "tabs-content");
    active.setAttribute("data-state", "active");
    const visible = document.createElement("div");
    visible.setAttribute("data-slot", "alert");
    visible.setAttribute("role", "alert");
    visible.textContent = "研究收敛 共同结论：一次性用原生 agent。";
    active.append(visible);
    const inactive = document.createElement("div");
    inactive.setAttribute("data-slot", "tabs-content");
    inactive.setAttribute("data-state", "inactive");
    inactive.setAttribute("hidden", "");
    const hiddenAlert = document.createElement("div");
    hiddenAlert.setAttribute("data-slot", "alert");
    hiddenAlert.setAttribute("role", "alert");
    hiddenAlert.textContent =
      "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。";
    inactive.append(hiddenAlert);
    host.append(active, inactive);
    document.body.append(host);
    const located = locate({
      host,
      pickedNodeThreads: [
        thread(
          "sdk",
          1,
          "物料在 SDK 里，不在人眼前 生成合同只允许 import pier/canvas、react、相对路径。"
        ),
      ],
    });
    expect(located.pins).toEqual([]);
    expect(located.hiddenPins).toHaveLength(1);
    expect(located.hiddenPins[0]?.key.startsWith("label:")).toBe(true);
    host.remove();
  });

  it("does not let file-level comments change locatable pin numbers", () => {
    const host = document.createElement("div");
    const newer = document.createElement("div");
    newer.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "new");
    host.append(newer);
    document.body.append(host);
    const located = locate({
      host,
      locatedByAnchorId: new Map([["new", [thread("new", 200)]]]),
      pickedNodeThreads: [thread("file", 50)],
    });
    expect(located.pins.map((pin) => [pin.key, pin.index])).toEqual([
      ["anchor-new", 1],
    ]);
    expect(located.hiddenPins).toEqual([]);
    expect(located.driftThreads.map((entry) => entry.threadId)).toEqual([
      "file",
    ]);
    host.remove();
  });
});
