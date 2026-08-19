import {
  buildCanvasCommentNavTargets,
  revealCanvasCommentNavTarget,
  revealCanvasTabPanelForTarget,
  scheduleCanvasCommentPinScroll,
} from "@plugins/builtin/files/renderer/preview/canvas-comment-nav.ts";
import type { CanvasCommentPinView } from "@plugins/builtin/files/renderer/preview/canvas-comment-pins.tsx";
import type { CanvasCommentThreadView } from "@plugins/builtin/files/renderer/preview/use-canvas-preview-comments.ts";
import { CANVAS_COMMENT_ANCHOR_ATTR } from "@shared/comments/canvas-anchor.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function thread(id: string, createdAt: number): CanvasCommentThreadView {
  return {
    comment: {
      authorLabel: "You",
      body: `note ${id}`,
      createdAt,
      id: `c-${id}`,
    },
    threadId: id,
  };
}

function pin(
  key: string,
  index: number,
  entry: CanvasCommentThreadView
): CanvasCommentPinView {
  return {
    index,
    key,
    left: 0,
    threads: [entry],
    title: key,
    top: 0,
  };
}

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const node of mounted.splice(0)) {
    node.remove();
  }
});

describe("buildCanvasCommentNavTargets", () => {
  it("steps through locatable pins so n/N matches the glyphs", () => {
    const visible = thread("visible", 100);
    const hidden = thread("hidden", 200);
    const targets = buildCanvasCommentNavTargets({
      hiddenPins: [pin("anchor-hidden", 2, hidden)],
      pins: [pin("anchor-visible", 1, visible)],
    });
    expect(
      targets.map((entry) => [entry.threadId, entry.index, entry.pinKey])
    ).toEqual([
      ["visible", 1, "anchor-visible"],
      ["hidden", 2, "anchor-hidden"],
    ]);
  });

  it("includes unmounted identity groups so other tabs still count", () => {
    const onTab = thread("on-tab", 100);
    const away = thread("away", 200);
    const targets = buildCanvasCommentNavTargets({
      hiddenPins: [pin("label:落地", 2, away)],
      pins: [pin("label:设计", 1, onTab)],
    });
    expect(targets.map((entry) => [entry.index, entry.pinKey])).toEqual([
      [1, "label:设计"],
      [2, "label:落地"],
    ]);
  });
});

describe("revealCanvasTabPanelForTarget", () => {
  it("clicks the aria-labelledby tab trigger for an inactive panel", () => {
    const trigger = document.createElement("button");
    trigger.id = "tab-live";
    const onClick = vi.fn();
    trigger.addEventListener("click", onClick);
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("data-state", "inactive");
    panel.setAttribute("hidden", "");
    panel.setAttribute("aria-labelledby", "tab-live");
    const inner = document.createElement("p");
    panel.append(inner);
    document.body.append(trigger, panel);
    mounted.push(trigger, panel);
    expect(revealCanvasTabPanelForTarget(inner)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not click when the target is already visible", () => {
    const trigger = document.createElement("button");
    trigger.id = "tab-design";
    const onClick = vi.fn();
    trigger.addEventListener("click", onClick);
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("data-state", "active");
    panel.setAttribute("aria-labelledby", "tab-design");
    const inner = document.createElement("p");
    panel.append(inner);
    document.body.append(trigger, panel);
    mounted.push(trigger, panel);
    expect(revealCanvasTabPanelForTarget(inner)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("falls back to aria-controls when labelledby is missing", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-controls", "panel-live");
    const onClick = vi.fn();
    trigger.addEventListener("click", onClick);
    const panel = document.createElement("div");
    panel.id = "panel-live";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("data-state", "inactive");
    panel.setAttribute("hidden", "");
    const inner = document.createElement("p");
    panel.append(inner);
    document.body.append(trigger, panel);
    mounted.push(trigger, panel);
    expect(revealCanvasTabPanelForTarget(inner)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates an inactive tab trigger via mousedown (Radix Tabs)", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "tabs-trigger");
    trigger.setAttribute("role", "tab");
    trigger.setAttribute("data-state", "inactive");
    trigger.setAttribute("aria-selected", "false");
    const onMouseDown = vi.fn();
    trigger.addEventListener("mousedown", onMouseDown);
    document.body.append(trigger);
    mounted.push(trigger);
    expect(revealCanvasTabPanelForTarget(trigger)).toBe(true);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleCanvasCommentPinScroll", () => {
  it("scrolls once the pin mounts", async () => {
    const shell = document.createElement("div");
    document.body.append(shell);
    mounted.push(shell);
    const cleanup = scheduleCanvasCommentPinScroll(shell, 2);
    const pinEl = document.createElement("div");
    pinEl.setAttribute("data-canvas-comment-pin", "2");
    const scrollIntoView = vi.fn();
    pinEl.scrollIntoView = scrollIntoView;
    shell.append(pinEl);
    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "center",
      });
    });
    cleanup();
  });
});

describe("revealCanvasCommentNavTarget", () => {
  it("clicks the hidden tab, opens the pin, and waits to scroll", async () => {
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.id = "tab-live";
    const onClick = vi.fn();
    trigger.addEventListener("click", onClick);
    const panel = document.createElement("div");
    panel.setAttribute("data-slot", "tabs-content");
    panel.setAttribute("data-state", "inactive");
    panel.setAttribute("hidden", "");
    panel.setAttribute("aria-labelledby", "tab-live");
    const targetEl = document.createElement("div");
    targetEl.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "card");
    panel.append(targetEl);
    host.append(trigger, panel);
    const shell = document.createElement("div");
    document.body.append(host, shell);
    mounted.push(host, shell);
    const hidden = pin("anchor-card", 2, thread("card", 1));
    const onOpenPin = vi.fn();
    const cleanup = revealCanvasCommentNavTarget({
      hiddenPins: [hidden],
      host,
      onOpenPin,
      pins: [],
      shell,
      target: {
        commentId: "c-card",
        index: 2,
        pinKey: "anchor-card",
        threadId: "card",
        anchorId: "card",
      },
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    const pinEl = document.createElement("div");
    pinEl.setAttribute("data-canvas-comment-pin", "2");
    const scrollIntoView = vi.fn();
    pinEl.scrollIntoView = scrollIntoView;
    shell.append(pinEl);
    await vi.waitFor(() => {
      expect(onOpenPin).toHaveBeenCalledWith("anchor-card");
      expect(scrollIntoView).toHaveBeenCalled();
    });
    cleanup();
  });

  it("restores the original tab when the hunt finds nothing", async () => {
    const host = document.createElement("div");
    const current = document.createElement("button");
    current.setAttribute("data-slot", "tabs-trigger");
    current.setAttribute("data-state", "active");
    current.setAttribute("aria-selected", "true");
    const currentClick = vi.fn();
    current.addEventListener("click", currentClick);
    const other = document.createElement("button");
    other.setAttribute("data-slot", "tabs-trigger");
    other.setAttribute("data-state", "inactive");
    other.setAttribute("aria-selected", "false");
    other.addEventListener("mousedown", () => {
      other.setAttribute("data-state", "active");
      other.setAttribute("aria-selected", "true");
      current.setAttribute("data-state", "inactive");
      current.setAttribute("aria-selected", "false");
    });
    host.append(current, other);
    document.body.append(host);
    mounted.push(host);
    const onOpenPin = vi.fn();
    const cleanup = revealCanvasCommentNavTarget({
      hiddenPins: [],
      host,
      onOpenPin,
      pins: [],
      shell: host,
      target: {
        commentId: "c-gone",
        index: 1,
        label: "NoSuchLabel",
        pinKey: "label:nosuchlabel",
        threadId: "gone",
      },
    });
    await vi.waitFor(() => {
      expect(currentClick).toHaveBeenCalled();
    });
    expect(onOpenPin).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not invent a pin for drift targets", () => {
    const onOpenPin = vi.fn();
    const cleanup = revealCanvasCommentNavTarget({
      hiddenPins: [],
      host: document.createElement("div"),
      onOpenPin,
      pins: [],
      shell: document.createElement("div"),
      target: {
        commentId: "c-drift",
        index: 1,
        pinKey: null,
        threadId: "drift",
      },
    });
    expect(onOpenPin).not.toHaveBeenCalled();
    cleanup();
  });

  it("clicks an inactive tab when the target is not mounted", async () => {
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "tabs-trigger");
    trigger.setAttribute("data-state", "inactive");
    const onMouseDown = vi.fn(() => {
      const panel = document.createElement("div");
      panel.setAttribute(CANVAS_COMMENT_ANCHOR_ATTR, "card");
      host.append(panel);
    });
    trigger.addEventListener("mousedown", onMouseDown);
    host.append(trigger);
    const shell = document.createElement("div");
    document.body.append(host, shell);
    mounted.push(host, shell);
    const onOpenPin = vi.fn();
    const cleanup = revealCanvasCommentNavTarget({
      hiddenPins: [],
      host,
      onOpenPin,
      pins: [],
      shell,
      target: {
        anchorId: "card",
        commentId: "c-card",
        index: 2,
        pinKey: "anchor-card",
        threadId: "card",
      },
    });
    await vi.waitFor(() => {
      expect(onMouseDown).toHaveBeenCalledTimes(1);
    });
    const pinEl = document.createElement("div");
    pinEl.setAttribute("data-canvas-comment-pin", "2");
    pinEl.scrollIntoView = vi.fn();
    shell.append(pinEl);
    await vi.waitFor(() => {
      expect(onOpenPin).toHaveBeenCalledWith("anchor-card");
    });
    cleanup();
  });
});
