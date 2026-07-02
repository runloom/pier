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

function stripUndefinedPatchFirstHalf(
  patch: ProjectPreferencesPatch,
  result: Partial<ProjectPreferences>
): void {
  if (patch.agentCommandOverrides !== undefined) {
    result.agentCommandOverrides = patch.agentCommandOverrides;
  }
  if (patch.agentDefaultArgs !== undefined) {
    result.agentDefaultArgs = patch.agentDefaultArgs;
  }
  if (patch.agentDefaultEnv !== undefined) {
    result.agentDefaultEnv = patch.agentDefaultEnv;
  }
  if (patch.defaultAgentId !== undefined) {
    result.defaultAgentId = patch.defaultAgentId;
  }
  if (patch.disabledAgentIds !== undefined) {
    result.disabledAgentIds = patch.disabledAgentIds;
  }
  if (patch.language !== undefined) {
    result.language = patch.language;
  }
  if (patch.monoFontFamily !== undefined) {
    result.monoFontFamily = patch.monoFontFamily;
  }
  if (patch.monoFontSize !== undefined) {
    result.monoFontSize = patch.monoFontSize;
  }
  if (patch.stylePresetId !== undefined) {
    result.stylePresetId = patch.stylePresetId;
  }
  if (patch.terminalCursorBlink !== undefined) {
    result.terminalCursorBlink = patch.terminalCursorBlink;
  }
}

function stripUndefinedPatchSecondHalf(
  patch: ProjectPreferencesPatch,
  result: Partial<ProjectPreferences>
): void {
  if (patch.terminalCursorStyle !== undefined) {
    result.terminalCursorStyle = patch.terminalCursorStyle;
  }
  if (patch.terminalNewCwdPolicy !== undefined) {
    result.terminalNewCwdPolicy = patch.terminalNewCwdPolicy;
  }
  if (patch.terminalPasteProtection !== undefined) {
    result.terminalPasteProtection = patch.terminalPasteProtection;
  }
  if (patch.terminalScrollbackMb !== undefined) {
    result.terminalScrollbackMb = patch.terminalScrollbackMb;
  }
  if (patch.theme !== undefined) {
    result.theme = patch.theme;
  }
  if (patch.uiFontFamily !== undefined) {
    result.uiFontFamily = patch.uiFontFamily;
  }
  if (patch.userKeymap !== undefined) {
    result.userKeymap = patch.userKeymap;
  }
  if (patch.windowZoomLevel !== undefined) {
    result.windowZoomLevel = patch.windowZoomLevel;
  }
  if (patch.worktreeBranchPrefix !== undefined) {
    result.worktreeBranchPrefix = patch.worktreeBranchPrefix;
  }
  if (patch.worktreeCopyPatterns !== undefined) {
    result.worktreeCopyPatterns = patch.worktreeCopyPatterns;
  }
  if (patch.worktreeSetupCommand !== undefined) {
    result.worktreeSetupCommand = patch.worktreeSetupCommand;
  }
}

function stripUndefinedPatch(
  patch: ProjectPreferencesPatch
): Partial<ProjectPreferences> {
  const result: Partial<ProjectPreferences> = {};
  stripUndefinedPatchFirstHalf(patch, result);
  stripUndefinedPatchSecondHalf(patch, result);
  return result;
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
