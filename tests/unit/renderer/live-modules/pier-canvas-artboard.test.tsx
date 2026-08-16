// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Artboard,
  ArtboardStage,
} from "@/lib/live-modules/pier-canvas-artboard.tsx";
import { openHtmlWorldPreview } from "@/stores/content-preview.store.ts";

vi.mock("@/stores/content-preview.store.ts", () => ({
  openHtmlWorldPreview: vi.fn(),
}));

describe("Artboard", () => {
  beforeEach(() => {
    vi.mocked(openHtmlWorldPreview).mockClear();
  });

  it("fits all frames in a static overview that does not steal page scroll", () => {
    render(
      <ArtboardStage title="Canvas 物料设计稿">
        <Artboard
          description="发现面"
          height={800}
          label="K1"
          title="设置 · 物料库首页"
          width={1280}
        >
          <p>home</p>
        </Artboard>
      </ArtboardStage>
    );

    expect(document.querySelector("[data-slot='artboard-stage']")).toBeTruthy();
    expect(
      document.querySelector("[data-slot='html-world-card']")
    ).toBeTruthy();
    expect(
      document.querySelector("[data-slot='html-world-viewport']")
    ).toBeTruthy();
    expect(document.querySelector("[data-slot='artboard-world']")).toBeTruthy();
    expect(
      (document.querySelector("[data-slot='artboard-world']") as HTMLElement)
        .style.backgroundColor
    ).toBe("");
    expect(document.querySelector("[data-slot='html-world-card']")).toHaveClass(
      "bg-background"
    );
    expect(
      document.querySelector("[data-slot='image-preview-controls']")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /zoom in/i })).toBeNull();

    const board = document.querySelector(
      "[data-slot='artboard']"
    ) as HTMLElement | null;
    expect(board).toBeTruthy();
    expect(board?.getAttribute("aria-label")).toBe("设置 · 物料库首页");
    expect(board?.style.width).toBe("1280px");
    expect(board?.style.flexShrink).toBe("0");
    expect(screen.getByText("K1")).toBeTruthy();
    expect(screen.getByText("发现面")).toBeTruthy();

    const frame = board?.querySelector("[data-slot='artboard-frame']");
    expect(frame).toBeTruthy();
    expect((frame as HTMLElement).style.height).toBe("800px");
    expect((frame as HTMLElement).style.overflow).toBe("hidden");
    expect(screen.getByText("home")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "View fullscreen" })
    ).toBeTruthy();
  });

  it("opens the host content preview for fullscreen pan and zoom", () => {
    render(
      <ArtboardStage expandLabel="全屏查看" title="设计稿">
        <Artboard title="Home">
          <p>home</p>
        </Artboard>
      </ArtboardStage>
    );

    fireEvent.click(screen.getByRole("button", { name: "全屏查看" }));
    expect(openHtmlWorldPreview).toHaveBeenCalledTimes(1);
    const request = vi.mocked(openHtmlWorldPreview).mock.calls[0]?.[0];
    expect(request?.["aria-label"]).toBe("设计稿");
    expect(request?.title).toBe("设计稿");
    expect(typeof request?.render).toBe("function");
  });

  it("defaults to a 1280×800 clipped frame", () => {
    render(
      <Artboard title="Home">
        <p>home</p>
      </Artboard>
    );
    const frame = document.querySelector(
      "[data-slot='artboard-frame']"
    ) as HTMLElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.style.height).toBe("800px");
    expect(frame?.style.overflow).toBe("hidden");
  });
});

describe("canvas preview artboard stage", () => {
  it("keeps the reading column when an artboard card is present", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/preview/canvas.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("max-w-5xl");
    expect(source).not.toContain("has-[[data-slot=artboard-stage]]:max-w-none");
  });
});
