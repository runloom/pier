import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function selectorListForPseudo(css: string, pseudo: string): string {
  const escapedPseudo = pseudo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`:where\\(([\\s\\S]*?)\\)${escapedPseudo}\\s*\\{`)
  );
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
}

function selectorItemsForPseudo(css: string, pseudo: string): string[] {
  return selectorListForPseudo(css, pseudo)
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean);
}

describe("Pier dockview resize scrollbar CSS", () => {
  it("hides dockview web scrollbars during live resize", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain(
      ".dockview-theme-pier .dv-scrollable.dv-scrollable-resizing .dv-scrollbar"
    );
    expect(css).toContain("opacity: 0");
    expect(css).toContain("pointer-events: none");
  });
});

describe("Pier scrollbar policy CSS", () => {
  it("routes regular data-scrollbar containers through the custom WebKit scrollbar rules", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    const regularScrollbarSelector = "[data-scrollbar]";
    const webkitRulesStart = css.indexOf(
      "@supports selector(::-webkit-scrollbar)"
    );
    expect(webkitRulesStart).toBeGreaterThanOrEqual(0);
    const webkitRules = css.slice(webkitRulesStart);

    expect(
      selectorItemsForPseudo(webkitRules, "::-webkit-scrollbar")
    ).toContain(regularScrollbarSelector);
    expect(
      selectorItemsForPseudo(webkitRules, "::-webkit-scrollbar-thumb")
    ).toContain(regularScrollbarSelector);
    expect(
      selectorItemsForPseudo(webkitRules, "::-webkit-scrollbar-track")
    ).toContain(regularScrollbarSelector);
  });

  it("keeps thumbs hidden at idle and never reveals them from container hover", () => {
    const css = readFileSync(
      join(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );

    expect(css).toContain('data-scrollbar-scrolling="true"');
    expect(css).toContain('data-scrollbar-hovering="true"');
    expect(css).toContain("background: transparent");
    expect(css).not.toContain("):hover::-webkit-scrollbar-thumb");
    expect(css).not.toContain("::-webkit-scrollbar-thumb:hover");
  });

  it("requires scrollable primitives to declare the shared overlay policy", () => {
    for (const file of ["dropdown-menu.tsx", "popover.tsx", "select.tsx"]) {
      const source = readFileSync(
        join(process.cwd(), "packages/ui/src", file),
        "utf8"
      );
      expect(source, file).toContain('data-scrollbar="overlay"');
    }
  });
});
