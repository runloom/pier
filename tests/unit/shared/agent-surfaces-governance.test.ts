/**
 * Gold-standard ratchet for composer L1 surfaces:
 * - every surface command/bundled skill has en + zh-CN locale keys
 * - skill force-invoke prefixes stay explicit (no silent default `/`)
 * - free-typed `/xxx` remains Enter-passthrough for empty surfaces
 */
import {
  getAgentComposerSurface,
  listBuiltinCommands,
  listBundledSkills,
  listComposerSurfaceAgentKinds,
} from "@shared/agent-surfaces/index.ts";
import {
  agentSupportsSkillForceInvoke,
  skillInvokePrefix,
  skillInvokeText,
} from "@shared/skill-invoke.ts";
import { describe, expect, it } from "vitest";
import { terminal as enTerminal } from "@/i18n/locales/en/terminal.ts";
import { terminal as zhTerminal } from "@/i18n/locales/zh-CN/terminal.ts";

type NestedDesc = Record<string, Record<string, string>>;

function asNestedDesc(value: unknown): NestedDesc {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as NestedDesc;
}

describe("agent-surfaces L1 gold-standard governance", () => {
  const surfaceKinds = listComposerSurfaceAgentKinds();
  const enCommands = asNestedDesc(enTerminal.composer.commandDesc);
  const zhCommands = asNestedDesc(zhTerminal.composer.commandDesc);
  const enSkills = asNestedDesc(enTerminal.composer.skillDesc);
  const zhSkills = asNestedDesc(zhTerminal.composer.skillDesc);

  it("registers a finite, sorted set of composer surface agent kinds", () => {
    expect(surfaceKinds.length).toBeGreaterThan(10);
    expect(surfaceKinds).toEqual(
      [...surfaceKinds].sort((a, b) => a.localeCompare(b))
    );
    expect(surfaceKinds).toContain("claude");
    expect(surfaceKinds).toContain("codex");
    expect(surfaceKinds).toContain("openclaude");
  });

  it("localizes every builtin command description in en and zh-CN", () => {
    for (const agentKind of surfaceKinds) {
      const localeKind = agentKind === "openclaude" ? "claude" : agentKind;
      for (const command of listBuiltinCommands(agentKind)) {
        const en = enCommands[localeKind]?.[command.id];
        const zh = zhCommands[localeKind]?.[command.id];
        // kilo inherits opencode commands — allow opencode locale fallback.
        if (agentKind === "kilo" && (en == null || zh == null)) {
          expect(enCommands.opencode?.[command.id]?.length).toBeGreaterThan(0);
          expect(zhCommands.opencode?.[command.id]?.length).toBeGreaterThan(0);
          continue;
        }
        expect(
          en,
          `missing en commandDesc.${localeKind}.${command.id}`
        ).toBeTypeOf("string");
        expect(en?.trim().length).toBeGreaterThan(0);
        expect(
          zh,
          `missing zh commandDesc.${localeKind}.${command.id}`
        ).toBeTypeOf("string");
        expect(zh?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("localizes every host bundled skill description in en and zh-CN", () => {
    for (const agentKind of surfaceKinds) {
      const localeKind = agentKind === "openclaude" ? "claude" : agentKind;
      for (const skill of listBundledSkills(agentKind)) {
        const en = enSkills[localeKind]?.[skill.id];
        const zh = zhSkills[localeKind]?.[skill.id];
        expect(en, `missing en skillDesc.${localeKind}.${skill.id}`).toBeTypeOf(
          "string"
        );
        expect(en?.trim().length).toBeGreaterThan(0);
        expect(zh, `missing zh skillDesc.${localeKind}.${skill.id}`).toBeTypeOf(
          "string"
        );
        expect(zh?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("uses $ only for codex and / for other skill force-invoke agents", () => {
    expect(skillInvokePrefix("codex")).toBe("$");
    expect(skillInvokePrefix("claude")).toBe("/");
    expect(skillInvokePrefix("openclaude")).toBe("/");
    expect(skillInvokePrefix("cursor")).toBe("/");
    expect(skillInvokePrefix("opencode")).toBe("/");
    expect(skillInvokePrefix("kilo")).toBe("/");
    expect(skillInvokePrefix("grok")).toBe("/");
  });

  it("does not invent skill force-invoke for unsupported or palette-only agents", () => {
    // No native force-invoke skill catalog (documented in skill-invoke.ts).
    expect(skillInvokePrefix("aider")).toBeNull();
    expect(skillInvokePrefix("continue")).toBeNull();
    expect(skillInvokePrefix("unknown-agent")).toBeNull();
    expect(skillInvokePrefix(null)).toBeNull();
    // Goose: no bare /id prefix; L1 inserts `/skills <id>` via skillInvokeText.
    expect(skillInvokePrefix("goose")).toBeNull();
    expect(agentSupportsSkillForceInvoke("goose")).toBe(true);
    expect(skillInvokeText("goose", "pier-canvas")).toBe("/skills pier-canvas");
    // Palette-driven: commands surface empty; no slash skill insert either.
    expect(skillInvokePrefix("amp")).toBeNull();
    expect(skillInvokePrefix("crush")).toBeNull();
    expect(agentSupportsSkillForceInvoke("amp")).toBe(false);
  });

  it("keeps amp/crush surfaces empty (palette-driven)", () => {
    expect(getAgentComposerSurface("amp")).toEqual({
      builtinCommands: [],
      bundledSkills: [],
    });
    expect(getAgentComposerSurface("crush")).toEqual({
      builtinCommands: [],
      bundledSkills: [],
    });
  });

  it("requires skill force-invoke support for any agent that lists bundled skills", () => {
    for (const agentKind of surfaceKinds) {
      if (listBundledSkills(agentKind).length === 0) {
        continue;
      }
      expect(
        agentSupportsSkillForceInvoke(agentKind),
        `${agentKind} ships bundled skills but has no force-invoke prefix`
      ).toBe(true);
    }
  });
});
