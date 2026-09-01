// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Artboard,
  ArtboardStage,
  Layer,
  WorldStage,
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
        "src/plugins/builtin/files/renderer/preview/canvas-stage.ts"
      ),
      "utf8"
    );
    expect(source).toContain("max-w-5xl");
    expect(source).not.toContain("has-[[data-slot=artboard-stage]]:max-w-none");
  });
});

describe("WorldStage", () => {
  it("always wraps; flow children use the ArtboardStage line width", () => {
    render(
      <WorldStage>
        <Artboard height={360} title="A" width={560}>
          <p>a</p>
        </Artboard>
        <Artboard height={360} title="B" width={560}>
          <p>b</p>
        </Artboard>
      </WorldStage>
    );
    const stage = document.querySelector(
      "[data-canvas-stage='world']"
    ) as HTMLElement | null;
    expect(stage).toBeTruthy();
    expect(stage?.style.flexWrap).toBe("wrap");
    // 3×1280 + 2×56 gap + 2×48 padding — same line as ArtboardStage.
    expect(stage?.style.width).toBe("4048px");
  });

  it("envelopes Layer-only children and still wraps", () => {
    render(
      <WorldStage>
        <Layer h={100} w={200} x={40} y={24}>
          <p>pin</p>
        </Layer>
      </WorldStage>
    );
    const stage = document.querySelector(
      "[data-canvas-stage='world']"
    ) as HTMLElement | null;
    expect(stage?.style.flexWrap).toBe("wrap");
    expect(stage?.style.width).toBe("336px");
    expect(stage?.style.height).toBe("220px");
  });

  it("remaps Artboard caption ink against a light world floor", () => {
    render(
      <WorldStage background="#d8cfc0">
        <Artboard
          description="点书名打开。去掉要确认。"
          label="F1"
          title="书籍"
        >
          <p>books</p>
        </Artboard>
      </WorldStage>
    );
    const stage = document.querySelector(
      "[data-canvas-stage='world']"
    ) as HTMLElement | null;
    expect(stage?.style.getPropertyValue("--pier-world-caption")).toBe(
      "#171717"
    );
    expect(stage?.style.getPropertyValue("--pier-world-caption-muted")).toBe(
      "#525252"
    );
    expect(screen.getByText("书籍").style.color).toContain(
      "--pier-world-caption"
    );
    expect(screen.getByText("点书名打开。去掉要确认。").style.color).toContain(
      "--pier-world-caption-muted"
    );
  });
});
