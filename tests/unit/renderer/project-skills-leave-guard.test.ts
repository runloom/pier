import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogMocks = vi.hoisted(() => ({
  showAppConfirm: vi.fn(async () => true),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  current: {
    planPending: false,
    applyPending: false,
    writesFrozen: false,
    editDraftBySkillId: {} as Record<string, string>,
    mode: { kind: "detail" } as
      | { kind: "detail" }
      | { kind: "import-review"; candidate: { token: string } },
    projectRef: { realPath: "/tmp/proj" } as { realPath: string } | null,
    setEditDraft: vi.fn(),
    removeCandidate: vi.fn(),
    setMode: vi.fn(),
  },
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppConfirm: dialogMocks.showAppConfirm,
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@/stores/project-skills.store.ts", () => ({
  useProjectSkillsStore: {
    getState: () => storeState.current,
  },
}));

vi.mock(
  "@/pages/settings/components/skills/skills-candidate-lifecycle.ts",
  () => ({
    discardActiveImportReview: vi.fn(async () => {
      if (storeState.current.mode.kind === "import-review") {
        storeState.current.setMode({ kind: "detail" });
      }
    }),
    discardReviewCandidate: vi.fn(),
    discardPreparedCandidate: vi.fn(),
  })
);

import { discardActiveImportReview } from "@/pages/settings/components/skills/skills-candidate-lifecycle.ts";
import {
  confirmDiscardSkillEditDrafts,
  leaveSkillsTransientState,
} from "@/pages/settings/components/skills/skills-shared.tsx";

describe("project skills leave guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogMocks.showAppConfirm.mockResolvedValue(true);
    storeState.current = {
      planPending: false,
      applyPending: false,
      writesFrozen: false,
      editDraftBySkillId: {},
      mode: { kind: "detail" },
      projectRef: { realPath: "/tmp/proj" },
      setEditDraft: vi.fn(),
      removeCandidate: vi.fn(),
      setMode: vi.fn(),
    };
  });

  it("blocks leave while writes are frozen and surfaces a toast", async () => {
    storeState.current.writesFrozen = true;
    const ok = await leaveSkillsTransientState(((key: string) => key) as never);
    expect(ok).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "settings.skills.leaveBlocked"
    );
    expect(discardActiveImportReview).not.toHaveBeenCalled();
  });

  it("confirms and clears edit drafts before discarding import review", async () => {
    storeState.current.editDraftBySkillId = { "review-guide": "# draft" };
    storeState.current.mode = {
      kind: "import-review",
      candidate: { token: "tok-1" },
    };
    const ok = await leaveSkillsTransientState(((key: string) => key) as never);
    expect(ok).toBe(true);
    expect(dialogMocks.showAppConfirm).toHaveBeenCalled();
    expect(storeState.current.setEditDraft).toHaveBeenCalledWith(
      "review-guide",
      null
    );
    expect(discardActiveImportReview).toHaveBeenCalled();
  });

  it("returns false when the user cancels draft discard", async () => {
    storeState.current.editDraftBySkillId = { "review-guide": "# draft" };
    dialogMocks.showAppConfirm.mockResolvedValue(false);
    const ok = await confirmDiscardSkillEditDrafts(
      ((key: string) => key) as never
    );
    expect(ok).toBe(false);
    expect(storeState.current.setEditDraft).not.toHaveBeenCalled();
  });
});
