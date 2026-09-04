import type {
  PanelDescriptor,
  PanelSnapshot,
} from "@shared/contracts/panel.ts";
import { FALLBACK_LOCALE } from "@shared/i18n/locales.ts";
import {
  buildWindowIdentityDraft,
  type WindowIdentityDraft,
  windowDisplayCopyForLocale,
} from "@shared/window-display/index.ts";

export type WindowDisplayDraftPatch = Omit<
  WindowIdentityDraft,
  "iconKind" | "id" | "recordId"
>;

function descriptorToPanel(
  id: string,
  descriptor: PanelDescriptor,
  active: boolean
): PanelSnapshot {
  return {
    active,
    id,
    kind: descriptor.kind ?? "web",
    ...(descriptor.context ? { context: descriptor.context } : {}),
    display: descriptor.display,
    ...(descriptor.tab ? { tab: descriptor.tab } : {}),
  };
}

export function windowDisplayDraftFromDescriptors(
  activeId: string | null,
  descriptors: Readonly<Record<string, PanelDescriptor>>
): WindowDisplayDraftPatch {
  const panels = Object.entries(descriptors).map(([id, descriptor]) =>
    descriptorToPanel(id, descriptor, id === activeId)
  );
  const copy = windowDisplayCopyForLocale(FALLBACK_LOCALE);
  const draft = buildWindowIdentityDraft(
    { focused: false, id: "local", recordId: "local" },
    panels,
    0,
    copy
  );
  // Empty-window copy is numbered locally (wrong globally); omit it so main
  // assigns `窗口 N`. A stable tab used as baseLabel is real identity.
  const emptyFallback = copy.emptyWindow(1);
  const hasIdentity = Boolean(
    draft.projectPath ||
      draft.stableTabQualifier ||
      (draft.baseLabel && draft.baseLabel !== emptyFallback)
  );
  return {
    ...(hasIdentity && draft.baseLabel ? { baseLabel: draft.baseLabel } : {}),
    ...(draft.branch ? { branch: draft.branch } : {}),
    ...(draft.projectPath ? { projectPath: draft.projectPath } : {}),
    ...(draft.stableTabQualifier
      ? { stableTabQualifier: draft.stableTabQualifier }
      : {}),
  };
}
