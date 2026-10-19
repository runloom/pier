import { languageLabel } from "@plugins/builtin/files/renderer/editor/cm-language.ts";
import { languageForPath } from "@plugins/builtin/files/renderer/editor/language-detection.ts";
import { describe, expect, it } from "vitest";

const ROOT = "/workspace/pier";

describe("mermaid document language", () => {
  it("maps .mermaid and .mmd files to the mermaid language", () => {
    expect(
      languageForPath("docs/plans/figures/class-diagram.mermaid", ROOT)
    ).toBe("mermaid");
    expect(languageForPath("docs/plans/figures/flow.mmd", ROOT)).toBe(
      "mermaid"
    );
  });

  it("keeps neighboring markdown files on the markdown language", () => {
    expect(languageForPath("docs/plans/class-diagram.md", ROOT)).toBe(
      "markdown"
    );
  });

  it("labels the language badge as Mermaid", () => {
    expect(languageLabel("mermaid")).toBe("Mermaid");
  });
});
