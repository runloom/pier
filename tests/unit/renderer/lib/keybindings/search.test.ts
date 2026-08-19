import { describe, expect, it } from "vitest";
import {
  keybindingSearchHaystack,
  matchKeybindingQuery,
} from "@/lib/keybindings/search.ts";

describe("keybinding search", () => {
  it("matches when every token appears in the haystack", () => {
    const haystack = keybindingSearchHaystack([
      "复制路径和所选行",
      "Copy Path and Selected Lines",
      "pier.files.copyPathWithRange",
      "⌥⌘C",
      "Mod+Alt+KeyC",
    ]);

    expect(matchKeybindingQuery(haystack, "")).toBe(true);
    expect(matchKeybindingQuery(haystack, "  ")).toBe(true);
    expect(matchKeybindingQuery(haystack, "复制 路径")).toBe(true);
    expect(matchKeybindingQuery(haystack, "copy path")).toBe(true);
    expect(matchKeybindingQuery(haystack, "Alt")).toBe(true);
    expect(matchKeybindingQuery(haystack, "所选行 终端")).toBe(false);
  });

  it("matches modifier aliases and compact chords", () => {
    const haystack = keybindingSearchHaystack([
      "复制路径和所选行",
      "pier.files.copyPathWithRange",
      "⌥⌘C",
      "Mod+Alt+KeyC",
    ]);

    expect(matchKeybindingQuery(haystack, "cmd")).toBe(true);
    expect(matchKeybindingQuery(haystack, "command")).toBe(true);
    expect(matchKeybindingQuery(haystack, "ctrl")).toBe(true);
    expect(matchKeybindingQuery(haystack, "opt")).toBe(true);
    expect(matchKeybindingQuery(haystack, "option")).toBe(true);
    expect(matchKeybindingQuery(haystack, "cmd+alt+c")).toBe(true);
    expect(matchKeybindingQuery(haystack, "Ctrl+Alt+C")).toBe(true);
    expect(matchKeybindingQuery(haystack, "⌘C")).toBe(true);
    expect(matchKeybindingQuery(haystack, "⌥⌘C")).toBe(true);
    expect(matchKeybindingQuery(haystack, "cmd+alt+z")).toBe(false);
  });
});
