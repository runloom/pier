import type {
  ApplyResult,
  ProjectRootRef,
} from "@shared/contracts/project-skills.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftIsDirty,
  type SkillsUiDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { initProjectSkillsBridge } from "@/stores/project-skills-actions.ts";

function ref(path = "/tmp/proj"): ProjectRootRef {
  return {
    realPath: path,
    volumeIdentity: "vol",
    directoryIdentity: "dir",
  };
}

function draft(partial: Partial<SkillsUiDraft> = {}): SkillsUiDraft {
  return {
    importTokens: [],
    deliveryAgents: true,
    deliveryClaude: false,
    enabledBySkillId: { "review-guide": true },
    deleteSkillIds: [],
    ...partial,
  };
}

function installMock(options?: {
  applyResult?: ApplyResult;
  holdFirstPlan?: boolean;
  planDigest?: string;
}) {
  const listeners: Array<(event: unknown) => void> = [];
  let planCall = 0;
  let releaseFirstPlan: (() => void) | null = null;
  const firstPlanGate = options?.holdFirstPlan
    ? new Promise<void>((resolve) => {
        releaseFirstPlan = resolve;
      })
    : null;
  const plan = vi.fn(
    async (
      _projectRef: ProjectRootRef,
      observedRevision: string,
      _draft: unknown
    ) => {
      planCall += 1;
      if (planCall === 1 && firstPlanGate) {
        await firstPlanGate;
      }
      return {
        applicable: true,
        blockingIssues: [],
        confirmationRequirements: [],
        observedRevision,
        planDigest: resolvePlanDigest(planCall, options?.planDigest),
      };
    }
  );
  const apply = vi.fn(
    async () =>
      options?.applyResult ??
      ({
        status: "converged",
        operationId: "op-1",
        revisions: {
          manifestRevision: "m1",
          observedRevision: "obs-2",
        },
        targetResults: [],
        snapshot: { observedRevision: "obs-2" },
      } satisfies ApplyResult)
  );
  const snapshot = vi.fn(async (projectRef: ProjectRootRef) => ({
    observedRevision: "obs-1",
    projectRef: {
      realPath: projectRef.realPath,
      volumeIdentity: "live-vol",
      directoryIdentity: "live-dir",
    },
    skills: [],
    manifest: {
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    },
  }));
  const projectsSnapshot = vi.fn(async () => []);
  const operationStatus = vi.fn(async () => ({
    kind: "terminal",
    status: "not-applied",
  }));
  const onInvalidated = vi.fn((cb: (event: unknown) => void) => {
    listeners.push(cb);
    return () => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  });

  (window as unknown as { pier: { projectSkills: unknown } }).pier = {
    projectSkills: {
      apply,
      onInvalidated,
      operationStatus,
      plan,
      projectsSnapshot,
      snapshot,
    },
  };

  return {
    apply,
    emitInvalidated: (event: unknown) => {
      for (const cb of listeners) cb(event);
    },
    onInvalidated,
    operationStatus,
    plan,
    releaseFirstPlan: () => {
      releaseFirstPlan?.();
    },
    snapshot,
  };
}

function resolvePlanDigest(
  planCall: number,
  planDigest: string | undefined
): string {
  if (planCall !== 1 && planDigest === "late") {
    return "fresh";
  }
  return planDigest ?? "digest-1";
}

interface SnapshotMockResult {
  manifest: {
    version: number;
    delivery: { agents: boolean; claude: boolean };
    skills: never[];
  };
  observedRevision: string;
  projectRef: ProjectRootRef;
  skills: never[];
}

describe("project-skills store", () => {
  beforeEach(() => {
    useProjectSkillsStore.getState().reset();
  });

  it("drops late plan responses for older drafts", async () => {
    const mock = installMock({ holdFirstPlan: true, planDigest: "late" });
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({ observedRevision: "obs-1" });
    store.setDraft(draft({ deliveryClaude: false }));

    const first = store.planDraft();
    // Newer draft supersedes the in-flight plan.
    store.setDraft(draft({ deliveryClaude: true }));
    const secondPromise = store.planDraft();
    mock.releaseFirstPlan();
    const [late, second] = await Promise.all([first, secondPromise]);

    expect(late).toBeNull();
    expect(second?.planDigest).toBe("fresh");
    expect(useProjectSkillsStore.getState().lastPlan?.planDigest).toBe("fresh");
  });

  it("applies only for the issued operation id and clears draft on converge", async () => {
    const mock = installMock();
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({ observedRevision: "obs-1" });
    store.setDraft(draft());
    const plan = await store.planDraft();
    expect(plan?.planDigest).toBe("digest-1");

    const result = await store.apply("op-keep");
    expect(result?.status).toBe("converged");
    expect(mock.apply).toHaveBeenCalledOnce();
    expect(useProjectSkillsStore.getState().draft).toBeNull();
    expect(useProjectSkillsStore.getState().lastApplyOperationId).toBe(
      "op-keep"
    );
  });

  it("preserves a retryable intent when an indeterminate operation is not applied", async () => {
    installMock();
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({
      draft: draft(),
      observedRevision: "obs-1",
      pendingOperationId: "op-pending",
      writesFrozen: true,
    });

    await store.pollOperation();

    const state = useProjectSkillsStore.getState();
    expect(state.draft).not.toBeNull();
    expect(state.errorMessage).toBe("operation-not-applied");
    expect(state.reloadRequired).toBe(false);
    expect(state.writesFrozen).toBe(false);
  });

  it("clears launch focus when ordinary navigation supersedes the deep link", () => {
    const store = useProjectSkillsStore.getState();
    store.requestOpenProject("/tmp/blocked", ["issue-1"]);
    store.selectProject(null);
    expect(useProjectSkillsStore.getState().pendingFocusIssueIds).toEqual([]);
  });

  it("marks reload required on invalidate when draft is dirty", async () => {
    installMock();
    const bridge = initProjectSkillsBridge();
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({ observedRevision: "obs-1" });
    store.setDraft(draft());
    await store.planDraft();
    expect(useProjectSkillsStore.getState().lastPlan).not.toBeNull();

    // Emit invalidate
    const mockPier = (
      window as unknown as {
        pier: {
          projectSkills: {
            onInvalidated: ReturnType<typeof vi.fn>;
          };
        };
      }
    ).pier.projectSkills;
    // Call the subscribed listener via a fresh emit helper
    const listeners: Array<(e: unknown) => void> = [];
    for (const call of mockPier.onInvalidated.mock.calls) {
      listeners.push(call[0] as (e: unknown) => void);
    }
    for (const cb of listeners) {
      // Main keys the event by `${volumeId}:${directoryIdentity}`.
      cb({
        type: "project-skills.invalidated",
        projectIdentity: "vol:dir",
        observedRevision: "obs-9",
      });
    }

    const state = useProjectSkillsStore.getState();
    expect(state.reloadRequired).toBe(true);
    expect(state.draft).not.toBeNull();
    expect(state.lastPlan).toBeNull();
    // apply blocked while reload required
    const applied = await state.apply("op-2");
    expect(applied).toBeNull();
    bridge.dispose();
  });

  it("ignores invalidate events for other projects", async () => {
    installMock();
    const bridge = initProjectSkillsBridge();
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({ observedRevision: "obs-1" });
    store.setDraft(draft());
    await store.planDraft();
    expect(useProjectSkillsStore.getState().lastPlan).not.toBeNull();

    const mockPier = (
      window as unknown as {
        pier: {
          projectSkills: {
            onInvalidated: ReturnType<typeof vi.fn>;
          };
        };
      }
    ).pier.projectSkills;
    for (const call of mockPier.onInvalidated.mock.calls) {
      (call[0] as (e: unknown) => void)({
        type: "project-skills.invalidated",
        projectIdentity: "other-vol:other-dir",
        observedRevision: "obs-9",
      });
    }

    // Unrelated project: neither reload flag nor plan reset.
    const state = useProjectSkillsStore.getState();
    expect(state.reloadRequired).toBe(false);
    expect(state.lastPlan).not.toBeNull();
    bridge.dispose();
  });

  it("adopts live projectRef from snapshot responses", async () => {
    installMock();
    const store = useProjectSkillsStore.getState();
    await store.loadSnapshot({
      realPath: "/tmp/proj",
      volumeIdentity: "unknown",
      directoryIdentity: "unknown",
    });
    const state = useProjectSkillsStore.getState();
    expect(state.projectRef).toEqual({
      realPath: "/tmp/proj",
      volumeIdentity: "live-vol",
      directoryIdentity: "live-dir",
    });
    expect(state.loadStatus).toBe("ready");
  });

  it("drops a late snapshot after returning to the project list", async () => {
    const mock = installMock();
    const pending = Promise.withResolvers<SnapshotMockResult>();
    mock.snapshot.mockReturnValueOnce(pending.promise);
    const store = useProjectSkillsStore.getState();
    const project = ref();
    store.selectProject(project);

    const load = store.loadSnapshot(project);
    store.selectProject(null);
    pending.resolve({
      observedRevision: "late",
      projectRef: project,
      skills: [],
      manifest: {
        version: 1,
        delivery: { agents: true, claude: false },
        skills: [],
      },
    });
    await load;

    const state = useProjectSkillsStore.getState();
    expect(state.projectRef).toBeNull();
    expect(state.snapshot).toBeNull();
    expect(state.mode).toEqual({ kind: "projects" });
  });

  it("drops a late snapshot when another project is selected", async () => {
    const mock = installMock();
    const pending = Promise.withResolvers<SnapshotMockResult>();
    mock.snapshot.mockReturnValueOnce(pending.promise);
    const store = useProjectSkillsStore.getState();
    const first = ref("/tmp/first");
    const second = {
      ...ref("/tmp/second"),
      directoryIdentity: "second-dir",
    };
    store.selectProject(first);

    const load = store.loadSnapshot(first);
    store.selectProject(second);
    pending.resolve({
      observedRevision: "late",
      projectRef: first,
      skills: [],
      manifest: {
        version: 1,
        delivery: { agents: true, claude: false },
        skills: [],
      },
    });
    await load;

    expect(useProjectSkillsStore.getState().projectRef).toEqual(second);
    expect(useProjectSkillsStore.getState().snapshot).toBeNull();
  });

  it("treats enabledBySkillId as clean when values match snapshot", () => {
    const dirty = draftIsDirty(
      {
        deleteSkillIds: [],
        deliveryAgents: true,
        deliveryClaude: false,
        enabledBySkillId: { "review-guide": false },
        importTokens: [],
      },
      {
        manifest: { delivery: { agents: true, claude: false } },
        skills: [{ id: "review-guide", enabled: false }],
      }
    );
    expect(dirty).toBe(false);
  });

  it("keeps page error clear when background plan fails", async () => {
    const mock = installMock();
    mock.plan.mockRejectedValueOnce(new Error("identity-mismatch"));
    const store = useProjectSkillsStore.getState();
    store.selectProject(ref());
    useProjectSkillsStore.setState({ observedRevision: "obs-1" });
    store.setDraft(draft());
    const plan = await store.planDraft();
    expect(plan).toBeNull();
    expect(useProjectSkillsStore.getState().errorMessage).toBeNull();
    expect(useProjectSkillsStore.getState().lastPlan).toBeNull();
  });
});
