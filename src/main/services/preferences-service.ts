import type { ProjectPreferencesPatch } from "@shared/contracts/commands.ts";
import type {
  PierEvent,
  PreferenceChangedKey,
} from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
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

function stripUndefinedPatch(
  patch: ProjectPreferencesPatch
): Partial<ProjectPreferences> {
  return {
    ...(patch.agentCommandOverrides !== undefined && {
      agentCommandOverrides: patch.agentCommandOverrides,
    }),
    ...(patch.agentDefaultArgs !== undefined && {
      agentDefaultArgs: patch.agentDefaultArgs,
    }),
    ...(patch.agentDefaultEnv !== undefined && {
      agentDefaultEnv: patch.agentDefaultEnv,
    }),
    ...(patch.defaultAgentId !== undefined && {
      defaultAgentId: patch.defaultAgentId,
    }),
    ...(patch.disabledAgentIds !== undefined && {
      disabledAgentIds: patch.disabledAgentIds,
    }),
    ...(patch.gitAutoFetchEnabled !== undefined && {
      gitAutoFetchEnabled: patch.gitAutoFetchEnabled,
    }),
    ...(patch.gitAutoFetchIntervalMinutes !== undefined && {
      gitAutoFetchIntervalMinutes: patch.gitAutoFetchIntervalMinutes,
    }),
    ...(patch.language !== undefined && { language: patch.language }),
    ...(patch.monoFontFamily !== undefined && {
      monoFontFamily: patch.monoFontFamily,
    }),
    ...(patch.monoFontSize !== undefined && {
      monoFontSize: patch.monoFontSize,
    }),
    ...(patch.stylePresetId !== undefined && {
      stylePresetId: patch.stylePresetId,
    }),
    ...(patch.terminalCursorBlink !== undefined && {
      terminalCursorBlink: patch.terminalCursorBlink,
    }),
    ...(patch.terminalCursorStyle !== undefined && {
      terminalCursorStyle: patch.terminalCursorStyle,
    }),
    ...(patch.terminalNewCwdPolicy !== undefined && {
      terminalNewCwdPolicy: patch.terminalNewCwdPolicy,
    }),
    ...(patch.terminalPasteProtection !== undefined && {
      terminalPasteProtection: patch.terminalPasteProtection,
    }),
    ...(patch.terminalScrollbackMb !== undefined && {
      terminalScrollbackMb: patch.terminalScrollbackMb,
    }),
    ...(patch.theme !== undefined && { theme: patch.theme }),
    ...(patch.uiFontFamily !== undefined && {
      uiFontFamily: patch.uiFontFamily,
    }),
    ...(patch.userKeymap !== undefined && {
      userKeymap: patch.userKeymap,
    }),
    ...(patch.windowZoomLevel !== undefined && {
      windowZoomLevel: patch.windowZoomLevel,
    }),
  };
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
