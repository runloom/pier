import { create } from "zustand";
import type { SettingsSectionId } from "@/pages/settings/data/appearance-nav.ts";
import {
  PROJECTS_SECTION_ID,
  type ProjectsSettingsTab,
  projectsTabFromSection,
  resolveProjectsSectionId,
} from "@/pages/settings/data/projects-settings.ts";

export type SettingsLeaveIntent =
  | { kind: "close"; reason?: string }
  | { kind: "section"; section: SettingsSectionId };

export interface SettingsSectionGuard {
  canLeave: () => boolean;
  leave: (intent: SettingsLeaveIntent) => Promise<boolean>;
}

function canonicalizeSection(section: SettingsSectionId): {
  section: SettingsSectionId;
  tab: ProjectsSettingsTab | null;
} {
  const resolved = resolveProjectsSectionId(section);
  if (!resolved) {
    return { section, tab: null };
  }
  return {
    section: PROJECTS_SECTION_ID,
    tab: projectsTabFromSection(section),
  };
}

interface SettingsDialogState {
  activeSection: SettingsSectionId;
  clearProjectsFocusPath: () => void;
  close: () => void;
  isOpen: boolean;
  leavePending: boolean;
  open: () => void;
  /** 打开设置对话框并定位到指定 section(右键「管理状态栏…」等入口用)。 */
  openSection: (section: SettingsSectionId) => void;
  pendingDestination: SettingsLeaveIntent | null;
  /** Optional one-shot project path focus for the projects shell. */
  projectsFocusPath: string | null;
  /** Preferred tab inside the projects shell (environment | skills). */
  projectsTab: ProjectsSettingsTab;
  registerSectionGuard: (
    section: SettingsSectionId,
    guard: SettingsSectionGuard | null
  ) => void;
  requestSectionChange: (section: SettingsSectionId) => Promise<boolean>;
  requestSettingsClose: (reason?: string) => Promise<boolean>;
  sectionGuards: Partial<Record<string, SettingsSectionGuard>>;
  setActiveSection: (section: SettingsSectionId) => void;
  setOpen: (open: boolean) => void;
  setProjectsTab: (tab: ProjectsSettingsTab) => void;
}

/**
 * Open paths set state immediately. Actual Dialog mount is deferred inside
 * `@pier/ui/dialog` so menu → settings handoffs stay clickable without
 * product code remembering scheduleAfterOverlay / modal=false.
 *
 * Section leave guards: dirty sections register canLeave/leave. Navigation and
 * close go through requestSectionChange / requestSettingsClose so guards run
 * before activeSection/isOpen change.
 *
 * Project settings IA: `environment` / `skills` deep links canonicalize to
 * `projects` and set `projectsTab`.
 */
export const useSettingsDialogStore = create<SettingsDialogState>(
  (set, get) => ({
    activeSection: "appearance",
    clearProjectsFocusPath: () => set({ projectsFocusPath: null }),
    close: () => {
      get()
        .requestSettingsClose("close")
        .catch(() => undefined);
    },
    isOpen: false,
    leavePending: false,
    open: () => set({ isOpen: true }),
    openSection: (section) => {
      const state = get();
      const { section: nextSection, tab } = canonicalizeSection(section);
      const patch =
        tab === null
          ? { activeSection: nextSection, isOpen: true as const }
          : {
              activeSection: nextSection,
              isOpen: true as const,
              projectsTab: tab,
            };
      // Deep links honor the section leave guard (design §7.7): a dirty
      // section must resolve (apply/discard/cancel) before navigating away.
      if (!state.isOpen || nextSection === state.activeSection) {
        set(patch);
        return;
      }
      set({
        isOpen: true,
        ...(tab === null ? {} : { projectsTab: tab }),
      });
      state.requestSectionChange(nextSection).catch(() => undefined);
    },
    pendingDestination: null,
    projectsFocusPath: null,
    projectsTab: "skills",
    sectionGuards: {},
    registerSectionGuard: (section, guard) => {
      set((state) => {
        const next = { ...state.sectionGuards };
        if (guard) {
          next[section] = guard;
        } else {
          delete next[section];
        }
        return { sectionGuards: next };
      });
    },
    requestSectionChange: async (section) => {
      const state = get();
      const { section: nextSection, tab } = canonicalizeSection(section);
      if (nextSection === state.activeSection) {
        if (tab !== null) {
          set({ projectsTab: tab });
        }
        return true;
      }
      if (state.leavePending) {
        set({ pendingDestination: { kind: "section", section: nextSection } });
        return false;
      }
      const guard = state.sectionGuards[state.activeSection];
      if (!guard || guard.canLeave()) {
        set({
          activeSection: nextSection,
          ...(tab === null ? {} : { projectsTab: tab }),
        });
        return true;
      }
      set({
        leavePending: true,
        pendingDestination: { kind: "section", section: nextSection },
        ...(tab === null ? {} : { projectsTab: tab }),
      });
      try {
        const ok = await guard.leave({ kind: "section", section: nextSection });
        const latest = get();
        const dest = latest.pendingDestination;
        if (ok && dest?.kind === "section") {
          set({
            activeSection: dest.section,
            leavePending: false,
            pendingDestination: null,
          });
          return true;
        }
        set({ leavePending: false, pendingDestination: null });
        return false;
      } catch {
        set({ leavePending: false, pendingDestination: null });
        return false;
      }
    },
    requestSettingsClose: async (reason) => {
      const state = get();
      if (!state.isOpen) {
        return true;
      }
      if (state.leavePending) {
        set({
          pendingDestination:
            reason === undefined
              ? { kind: "close" }
              : { kind: "close", reason },
        });
        return false;
      }
      const guard = state.sectionGuards[state.activeSection];
      if (!guard || guard.canLeave()) {
        set({ isOpen: false });
        return true;
      }
      const closeIntent =
        reason === undefined
          ? ({ kind: "close" } as const)
          : ({ kind: "close", reason } as const);
      set({
        leavePending: true,
        pendingDestination: closeIntent,
      });
      try {
        const ok = await guard.leave(closeIntent);
        if (ok) {
          set({ isOpen: false, leavePending: false, pendingDestination: null });
          return true;
        }
        set({ leavePending: false, pendingDestination: null });
        return false;
      } catch {
        set({ leavePending: false, pendingDestination: null });
        return false;
      }
    },
    setActiveSection: (activeSection) => {
      get()
        .requestSectionChange(activeSection)
        .catch(() => undefined);
    },
    setOpen: (isOpen) => {
      if (isOpen) {
        set({ isOpen: true });
        return;
      }
      get()
        .requestSettingsClose("setOpen")
        .catch(() => undefined);
    },
    setProjectsTab: (projectsTab) => set({ projectsTab }),
  })
);
