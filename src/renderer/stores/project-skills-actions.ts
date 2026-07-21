import type { ProjectSkillsInvalidatedEvent } from "@shared/contracts/project-skills.ts";
import { useProjectSkillsStore } from "./project-skills.store.ts";
import { draftIsDirty } from "./project-skills-model.ts";

let invalidateAttached = false;
let detachInvalidate: (() => void) | null = null;

export function initProjectSkillsBridge(): { dispose: () => void } {
  if (!invalidateAttached && typeof window !== "undefined") {
    const detach = window.pier?.projectSkills?.onInvalidated?.(
      (event: ProjectSkillsInvalidatedEvent) => {
        const state = useProjectSkillsStore.getState();
        if (!state.projectRef) {
          return;
        }
        // Main keys the event by `${volumeId}:${directoryIdentity}` — ignore
        // invalidations for other projects instead of reloading/flagging the
        // currently open one.
        if (
          typeof event?.projectIdentity === "string" &&
          event.projectIdentity !==
            `${state.projectRef.volumeIdentity}:${state.projectRef.directoryIdentity}`
        ) {
          return;
        }
        const observed =
          typeof event?.observedRevision === "string"
            ? event.observedRevision
            : undefined;
        const hasUnsavedEdits =
          Object.keys(state.editDraftBySkillId).length > 0;
        if (draftIsDirty(state.draft, state.snapshot) || hasUnsavedEdits) {
          state.markReloadRequired(observed);
        } else if (state.projectRef) {
          state.loadSnapshot(state.projectRef).catch(() => undefined);
        }
      }
    );
    if (detach) {
      detachInvalidate = detach;
      invalidateAttached = true;
    }
  }
  return {
    dispose: () => {
      detachInvalidate?.();
      detachInvalidate = null;
      invalidateAttached = false;
    },
  };
}
