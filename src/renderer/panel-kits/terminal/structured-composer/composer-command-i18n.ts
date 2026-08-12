import type { TFunction } from "i18next";

/** openclaude shares Claude’s surface + locale tables. */
function surfaceLocaleAgentKind(agentKind: string): string {
  return agentKind === "openclaude" ? "claude" : agentKind;
}

function translatedOrEmpty(t: TFunction, key: string): string {
  const translated = t(key, { defaultValue: "" });
  return typeof translated === "string" && translated.trim().length > 0
    ? translated
    : "";
}

/**
 * Resolve locale key for a built-in command description.
 * openclaude shares Claude’s surface table.
 */
export function composerCommandDescKey(
  agentKind: string,
  commandId: string
): string {
  const kind = surfaceLocaleAgentKind(agentKind);
  return `terminal.composer.commandDesc.${kind}.${commandId}`;
}

/**
 * Resolve locale key for a host bundled skill description.
 */
export function composerBundledSkillDescKey(
  agentKind: string,
  skillId: string
): string {
  const kind = surfaceLocaleAgentKind(agentKind);
  return `terminal.composer.skillDesc.${kind}.${skillId}`;
}

/**
 * Localized command detail for the suggest list.
 * Falls back to the English surface string when no locale entry exists.
 */
export function resolveComposerCommandDescription(
  t: TFunction,
  agentKind: string | null | undefined,
  commandId: string,
  fallback: string
): string {
  if (typeof agentKind !== "string" || agentKind.length === 0) {
    return fallback;
  }
  const direct = translatedOrEmpty(
    t,
    composerCommandDescKey(agentKind, commandId)
  );
  if (direct.length > 0) {
    return direct;
  }
  // kilo inherits OpenCode commands — try opencode keys when kilo-specific missing.
  if (agentKind === "kilo") {
    const fromOpenCode = translatedOrEmpty(
      t,
      composerCommandDescKey("opencode", commandId)
    );
    if (fromOpenCode.length > 0) {
      return fromOpenCode;
    }
  }
  return fallback;
}

/**
 * Localized bundled skill detail for the suggest list.
 * Falls back to the English surface string when no locale entry exists.
 */
export function resolveComposerBundledSkillDescription(
  t: TFunction,
  agentKind: string | null | undefined,
  skillId: string,
  fallback: string
): string {
  if (typeof agentKind !== "string" || agentKind.length === 0) {
    return fallback;
  }
  const direct = translatedOrEmpty(
    t,
    composerBundledSkillDescKey(agentKind, skillId)
  );
  if (direct.length > 0) {
    return direct;
  }
  return fallback;
}
