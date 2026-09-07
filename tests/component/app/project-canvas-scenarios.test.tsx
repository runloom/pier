import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { MaterialCard } from "../../../.pier/canvases/canvas-kit/shared.tsx";
import * as pierCanvasModule from "../../support/pier-canvas.ts";

/**
 * Renders every React canvas under `.pier/canvases` for real.
 *
 * Compiling a canvas only proves its imports resolve. Mounting it catches the
 * failures authors actually hit: a primitive used outside its required parent,
 * a hook misuse, a component rendered with props it does not accept.
 */
const CANVAS_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../../.pier/canvases/**/*.canvas.tsx",
  { eager: true }
);

beforeAll(async () => {
  await initI18n();
});

afterEach(cleanup);

function displayPath(path: string): string {
  return path.replace("../../../.pier/canvases/", "canvases/");
}

const IN_REPO_REACT_CANVASES = [
  "canvas-kit/canvas-kit.canvas.tsx",
  "mobile-web-shell/mobile-web-shell.canvas.tsx",
  "pier-cli-user-manual/pier-cli-user-manual.canvas.tsx",
  "smoke/hello.canvas.tsx",
  "workbench-shell/workbench-shell.canvas.tsx",
] as const;

describe("project canvases render", () => {
  it("exposes exactly the whitelisted pier/canvas exports", () => {
    expect(Object.keys(pierCanvasModule).sort()).toEqual(
      [...PIER_CANVAS_EXPORT_NAMES].sort()
    );
  });

  it("finds exactly the in-repo React canvases (kit + mobile shell + cli manual + smoke + workbench shell)", () => {
    const relative = Object.keys(CANVAS_MODULES)
      .filter((path) => !path.endsWith(".canvas.solid.tsx"))
      .map((path) => path.replace("../../../.pier/canvases/", ""))
      .sort();
    expect(relative).toEqual([...IN_REPO_REACT_CANVASES]);
  });

  for (const [path, module] of Object.entries(CANVAS_MODULES)) {
    if (path.endsWith(".canvas.solid.tsx")) {
      continue;
    }

    it(`mounts ${displayPath(path)}`, () => {
      const Canvas = module.default as ComponentType | undefined;
      if (typeof Canvas !== "function") {
        throw new Error(`${path} must default-export a component`);
      }
      const { container } = render(<Canvas />);
      expect(container.firstChild).not.toBeNull();
    });

    it(`declares valid metadata in ${displayPath(path)}`, () => {
      expect(parsePierCanvasMeta(module.canvas)).not.toBeNull();
    });
  }

  it("lets the mobile-web-shell pair frame toggle the viewfinder", () => {
    const path = Object.keys(CANVAS_MODULES).find((entry) =>
      entry.endsWith("mobile-web-shell/mobile-web-shell.canvas.tsx")
    );
    if (path === undefined) {
      throw new Error("mobile-web-shell canvas is missing");
    }
    const Canvas = CANVAS_MODULES[path]?.default as ComponentType | undefined;
    if (typeof Canvas !== "function") {
      throw new Error(
        "mobile-web-shell canvas must default-export a component"
      );
    }
    render(<Canvas />);
    expect(screen.getByText("对准二维码")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "停止扫码" }));
    expect(screen.getByText("取景框")).not.toBeNull();
  });

  it("pushes the session overlay from the mobile-web-shell prototype", () => {
    const path = Object.keys(CANVAS_MODULES).find((entry) =>
      entry.endsWith("mobile-web-shell/mobile-web-shell.canvas.tsx")
    );
    if (path === undefined) {
      throw new Error("mobile-web-shell canvas is missing");
    }
    const Canvas = CANVAS_MODULES[path]?.default as ComponentType | undefined;
    if (typeof Canvas !== "function") {
      throw new Error(
        "mobile-web-shell canvas must default-export a component"
      );
    }
    render(<Canvas />);
    const desk = screen.getAllByRole("button", { name: /办公桌 Mac mini/ })[0];
    const tree = screen.getAllByRole("button", { name: /feat-mobile/ })[0];
    if (!(desk && tree)) {
      throw new Error("mobile-web-shell host buttons are missing");
    }
    fireEvent.click(desk);
    fireEvent.click(tree);
    expect(
      document.querySelector("[data-slot='mobile-slide-overlay']")
    ).not.toBeNull();
  });

  it("switches the workbench-shell main window tile from the sidebar and restores each worktree's layout", () => {
    const path = Object.keys(CANVAS_MODULES).find((entry) =>
      entry.endsWith("workbench-shell/workbench-shell.canvas.tsx")
    );
    if (path === undefined) {
      throw new Error("workbench-shell canvas is missing");
    }
    const Canvas = CANVAS_MODULES[path]?.default as ComponentType | undefined;
    if (typeof Canvas !== "function") {
      throw new Error("workbench-shell canvas must default-export a component");
    }
    render(<Canvas />);
    // B4 内嵌同一主窗口，查询限定在 B1。
    const frame = document.querySelector<HTMLElement>(
      "[data-pier-comment-id='main']"
    );
    if (!frame) {
      throw new Error("workbench-shell main frame is missing");
    }
    const main = within(frame);
    expect(main.getByTestId("tile-status-pier-login").textContent).toContain(
      "fix/login"
    );
    expect(main.queryByTestId("tile-status-pier-billing")).toBeNull();
    expect(main.getByText("更改")).not.toBeNull();
    fireEvent.click(main.getByRole("button", { name: "切换到 pier-billing" }));
    expect(main.getByTestId("tile-status-pier-billing").textContent).toContain(
      "feat/billing"
    );
    expect(main.queryByTestId("tile-status-pier-login")).toBeNull();
    expect(
      main.getByText("pier-login", {
        selector: ".truncate.font-medium.text-muted-foreground",
      })
    ).not.toBeNull();
    expect(main.queryByText("更改")).toBeNull();
    expect(main.getByText("invoice.ts")).not.toBeNull();
    fireEvent.click(main.getByRole("button", { name: "切换到 pier-login" }));
    expect(main.getByText("更改")).not.toBeNull();
    fireEvent.click(main.getByRole("button", { name: "切换到 relay" }));
    expect(main.getByText("relay 还没有打开任何视图")).not.toBeNull();
    fireEvent.click(main.getByRole("button", { name: "定位 连接数指标" }));
    expect(main.getByText("将激活窗口 relay")).not.toBeNull();
    fireEvent.click(main.getByRole("button", { name: "打开 任务" }));
    expect(main.getByText("任务跟踪")).not.toBeNull();
    expect(main.getByText("#412")).not.toBeNull();
    expect(main.queryByText("将打开任务跟踪")).toBeNull();
    const sub = document.querySelector<HTMLElement>(
      "[data-pier-comment-id='sub']"
    );
    if (!sub) {
      throw new Error("workbench-shell sub frame is missing");
    }
    expect(within(sub).queryByRole("navigation", { name: "项目" })).toBeNull();
    expect(
      within(sub).getByRole("button", { name: "添加工作树到此窗口" })
    ).not.toBeNull();
    expect(within(sub).getAllByTestId(/^tile-status-/u)).toHaveLength(4);
  });

  it("renders material cards with fixed well and flush chrome", () => {
    // 2026-08-24 修版：井固定 h-28 居中；卡去自身 py/gap，h-full 行内等高。
    const { container } = render(
      <MaterialCard
        install='import { Button } from "pier/canvas"'
        lead="触发主操作"
        name="Button"
      >
        <span>sample</span>
      </MaterialCard>
    );
    const card = container.querySelector("[data-slot='card']");
    expect(card?.className).toContain("h-full");
    expect(card?.className).toContain("py-0");
    expect(card?.className).toContain("gap-0");
    expect(card?.firstElementChild?.className).toContain("h-28");
  });
});
