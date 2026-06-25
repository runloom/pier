import type { ProjectPreferencesPatch } from "@shared/contracts/commands.ts";
import type { PierEvent } from "@shared/contracts/events.ts";
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
      const next = await updatePreferences(stripUndefinedPatch(patch));
      eventBus?.publish({ snapshot: next, type: "preferences.changed" });
      return next;
    },
  };
}
