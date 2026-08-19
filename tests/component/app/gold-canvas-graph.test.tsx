// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { parseScheme } from "../../../.pier/canvases/multi-agent-orchestration-gold/model.ts";
import { DesignPage } from "../../../.pier/canvases/multi-agent-orchestration-gold/overview-sections.tsx";
import { installSvgLayoutStubs } from "../../support/svg-layout-stubs.ts";

const dataJson = readFileSync(
  join(
    process.cwd(),
    ".pier/canvases/multi-agent-orchestration-gold/data.json"
  ),
  "utf8"
);

beforeAll(async () => {
  installSvgLayoutStubs();
  await initI18n();
});

afterEach(cleanup);

describe("gold canvas architecture graph", () => {
  it("paints design-page architecture nodes with kind and layer tone", async () => {
    const scheme = parseScheme(dataJson);
    render(<DesignPage d={scheme.data} />);

    const stopCard = await waitFor(() => {
      const title = screen.getByText("focus / interrupt / terminate");
      const card = title.closest("[data-slot=mermaid-node]");
      expect(card).toBeTruthy();
      return card;
    });
    expect(stopCard?.getAttribute("data-kind")).toBe("tool");
    expect(stopCard?.getAttribute("data-tone")).toBe("success");

    const runtimeCard = screen
      .getByText("RuntimeControl")
      .closest("[data-slot=mermaid-node]");
    expect(runtimeCard?.getAttribute("data-kind")).toBe("artifact");
    expect(runtimeCard?.getAttribute("data-tone")).toBe("done");
  });
});
