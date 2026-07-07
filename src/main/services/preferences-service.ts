import type {
  PierEvent,
  PreferenceChangedKey,
} from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type { ProjectPreferencesPatch } from "@shared/contracts/preferences-patch.ts";
import {
  readPreferences as readPreferencesState,
  updatePreferences as updatePreferencesState,
} from "../state/preferences.ts";

export interface PreferencesService {
  read(): Promise<ProjectPreferences>;
  update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
}

export interface PreferencesEventPublisher {
  publish(event: PierEvent): void;
}

export interface CreatePreferencesServiceArgs {
  eventBus?: PreferencesEventPublisher;
  readPreferences?: () => Promise<ProjectPreferences>;
  updatePreferences?: (
    patch: Partial<ProjectPreferences>
  ) => Promise<ProjectPreferences>;
}

/** 白名单键——patch 里 undefined 的字段不下传 (zod 会替代为默认值)。 */
const PATCHABLE_KEYS = [
  "agentCommandOverrides",
  "agentDefaultArgs",
  "agentDefaultEnv",
  "agentPermissionMode",
  "agentStatusHooks",
  "defaultAgentId",
  "disabledAgentIds",
  "gitAutoFetchEnabled",
  "gitAutoFetchIntervalMinutes",
  "language",
  "monoFontFamily",
  "monoFontSize",
  "stylePresetId",
  "terminalCursorBlink",
  "terminalCursorStyle",
  "terminalNewCwdPolicy",
  "terminalPasteProtection",
  "terminalScrollbackMb",
  "theme",
  "uiFontFamily",
  "userKeymap",
  "windowZoomLevel",
  "worktreeRootPath",
] as const satisfies readonly (keyof ProjectPreferencesPatch)[];

function stripUndefinedPatch(
  patch: ProjectPreferencesPatch
): Partial<ProjectPreferences> {
  const out: Partial<ProjectPreferences> = {};
  for (const key of PATCHABLE_KEYS) {
    const value = patch[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function createPreferencesService({
  eventBus,
  readPreferences = readPreferencesState,
  updatePreferences = updatePreferencesState,
}: CreatePreferencesServiceArgs = {}): PreferencesService {
  return {
    read: () => readPreferences(),
    async update(patch) {
      const normalizedPatch = stripUndefinedPatch(patch);
      const changedKeys = Object.keys(
        normalizedPatch
      ) as PreferenceChangedKey[];
      const next = await updatePreferences(normalizedPatch);
      eventBus?.publish({
        changedKeys,
        snapshot: next,
        type: "preferences.changed",
      });
      return next;
    },
  };
}
