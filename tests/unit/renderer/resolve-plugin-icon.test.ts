import { FolderTree, Puzzle, Server } from "lucide-react";
import { describe, expect, it } from "vitest";
import { resolvePluginIcon } from "@/lib/plugins/resolve-plugin-icon.tsx";

describe("resolvePluginIcon", () => {
  it("uses the builtin module icon for files", () => {
    expect(resolvePluginIcon("pier.files")).toBe(FolderTree);
  });

  it("maps official managed plugins to brand or domain icons", () => {
    expect(resolvePluginIcon("pier.ssh")).toBe(Server);
    expect(resolvePluginIcon("pier.codex")).not.toBe(Puzzle);
    expect(resolvePluginIcon("pier.claude")).not.toBe(Puzzle);
    expect(resolvePluginIcon("pier.grok")).not.toBe(Puzzle);
  });

  it("falls back to Puzzle for unknown plugins", () => {
    expect(resolvePluginIcon("pier.unknown")).toBe(Puzzle);
  });
});
