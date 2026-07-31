import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContentDialogHost } from "@/components/common/dialogs/content-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/dialog.tsx";
import { resetAppContentDialogForTests } from "@/stores/app-content-dialog.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { makeFakePreferences } from "../../../setup/preferences-fixture.ts";

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppChoice: vi.fn(async () => "cancel" as const),
  showAppConfirm: vi.fn(async () => true),
}));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert: appDialogMocks.showAppAlert,
    showAppChoice: appDialogMocks.showAppChoice,
    showAppConfirm: appDialogMocks.showAppConfirm,
  };
});

const fixtures = vi.hoisted(() => ({
  plan: {
    applicable: true,
    blockingIssues: [],
    confirmationRequirements: [],
    observedRevision: "o1",
    planDigest: "digest",
  } as Record<string, unknown>,
  projectSource: "environment" as "environment" | "panel",
  skills: [
    {
      id: "review-guide",
      enabled: false,
      delivery: null,
      name: "Review Guide",
      description: "Review changes",
      managedBy: "user",
      contentDigest: `sha256:${"a".repeat(64)}`,
      effects: [],
      issueIds: [],
      fileCount: 1,
      totalBytes: 100,
      riskSummary: null,
      source: { type: "local-import" },
    },
  ] as Record<string, unknown>[],
  userGlobalSkills: [] as Record<string, unknown>[],
}));

const projectSkillsApi = vi.hoisted(() => ({
  apply: vi.fn(async () => ({
    status: "converged" as const,
    operationId: "op",
    revisions: { manifestRevision: "m", observedRevision: "o2" },
    targetResults: [],
    snapshot: {},
  })),
  doctor: vi.fn(async () => ({ issues: [] })),
  importDiscard: vi.fn(async () => undefined),
  importPrepare: vi.fn(async (): Promise<unknown> => null),
  importPrepareFromDiscovery: vi.fn(async () => ({ token: "tok" })),
  onInvalidated: vi.fn(() => () => undefined),
  operationStatus: vi.fn(async () => ({ status: "converged" })),
  pickProject: vi.fn(async () => null),
  plan: vi.fn(async () => fixtures.plan),
  skillRead: vi.fn(async () => ({
    skillMd: "---\nname: home-guide\n---\n# Home Guide\n",
    truncated: false,
  })),
  projectsSnapshot: vi.fn(async () => [
    {
      displayPath: "/tmp/demo",
      projectRef: {
        realPath: "/tmp/demo",
        volumeIdentity: "v",
        directoryIdentity: "d",
      },
      skillCount: 1,
      readStatus: "ok",
      checkedAt: 1,
      source: fixtures.projectSource,
    },
  ]),
  repair: vi.fn(async () => ({ status: "converged" })),
  repairPlan: vi.fn(async () => ({ executable: true })),
  snapshot: vi.fn(async () => ({
    observedRevision: "o1",
    skills: fixtures.skills,
    userGlobalSkills: fixtures.userGlobalSkills,
    manifest: {
      version: 1,
      delivery: { agents: true, claude: false },
      skills: [],
    },
    health: { issues: [] },
  })),
}));

function renderDialog() {
  return render(
    <TooltipProvider delayDuration={0} disableHoverableContent>
      <SettingsDialog />
      <AppContentDialogHost />
    </TooltipProvider>
  );
}

describe("settings dialog skills section", () => {
  beforeEach(async () => {
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await initI18n();
    usePluginRegistryStore.setState({ plugins: [] });
    useProjectSkillsStore.getState().reset();
    useSettingsDialogStore.setState({
      activeSection: "projects",
      projectsTab: "skills",
      projectsFocusPath: null,
      isOpen: true,
      leavePending: false,
      pendingDestination: null,
      sectionGuards: {},
    });
    useLocalEnvironmentsStore.setState({
      hydration: "ready",
      projects: [
        {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          kind: "pier-home",
          projectRootPath: "/tmp/pier-home",
          setupCommand: "",
          updatedAt: 1,
        },
        {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          kind: "project",
          projectRootPath: "/tmp/demo",
          setupCommand: "",
          updatedAt: 1,
        },
      ],
      version: 1,
      worktreeBindings: [],
    });
    (window as unknown as { pier: Record<string, unknown> }).pier = {
      preferences: {
        onChanged: () => () => undefined,
        read: async () => makeFakePreferences(),
        update: async (p: unknown) => p,
      },
      projectSkills: projectSkillsApi,
      pierHomeSkills: {
        list: vi.fn(async () => []),
        snapshot: vi.fn(async () => ({
          library: [],
          userGlobal: [
            {
              root: "~/.claude/skills",
              directoryName: "home-guide",
              name: "Home Guide",
              description: "Personal review workflow",
              absolutePath: "/tmp/home/.claude/skills/home-guide/SKILL.md",
            },
          ],
        })),
        create: vi.fn(),
        delete: vi.fn(),
        read: vi.fn(async () => "---\nname: home-guide\n---\n# Home Guide\n"),
        reveal: vi.fn(),
        setAlwaysInclude: vi.fn(),
        write: vi.fn(),
      },
      pierBindings: {
        list: vi.fn(async () => []),
        bind: vi.fn(async () => []),
        unbind: vi.fn(async () => []),
      },
      settings: { onOpenRequest: () => () => undefined },
      terminal: {},
      window: {},
    };
    appDialogMocks.showAppChoice.mockResolvedValue("cancel");
    appDialogMocks.showAppConfirm.mockResolvedValue(true);
    fixtures.plan = {
      applicable: true,
      blockingIssues: [],
      confirmationRequirements: [],
      observedRevision: "o1",
      planDigest: "digest",
    };
    fixtures.projectSource = "environment";
    fixtures.skills = [
      {
        id: "review-guide",
        enabled: false,
        delivery: null,
        name: "Review Guide",
        description: "Review changes",
        managedBy: "user",
        contentDigest: `sha256:${"a".repeat(64)}`,
        effects: [],
        issueIds: [],
        fileCount: 1,
        totalBytes: 100,
        riskSummary: null,
        source: { type: "local-import" },
      },
    ];
    fixtures.userGlobalSkills = [];
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.setState({ api: null });
  });

  afterEach(() => {
    cleanup();
    resetAppContentDialogForTests();
    vi.clearAllMocks();
  });

  it("renders projects nav and shared project list", async () => {
    renderDialog();
    expect(await screen.findByTestId("settings-nav-projects")).toBeTruthy();
    expect(await screen.findByText("demo")).toBeTruthy();
  });

  it("opens the skills tab workspace for a selected project", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
    expect(await screen.findByText("Review Guide")).toBeTruthy();
  });

  it("discards a prepared candidate that resolves after leaving detail", async () => {
    const pending = Promise.withResolvers<Record<string, unknown>>();
    projectSkillsApi.importPrepare.mockReturnValueOnce(pending.promise);
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getByText("Review Guide")).toBeTruthy();
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /Add skill|添加技能/ }),
      { button: 0, ctrlKey: false }
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /Import from folder|从文件夹导入/,
      })
    );
    await waitFor(() => {
      expect(projectSkillsApi.importPrepare).toHaveBeenCalledOnce();
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Back to projects|返回项目列表/,
      })
    );

    pending.resolve({
      token: "late-token",
      skillId: "late-skill",
      name: "Late Skill",
      description: "Late result",
      sourceKind: "local-import",
      sourceDisplayPath: "/tmp/late-skill",
      contentDigest: "digest",
      riskFingerprint: "",
      fileCount: 1,
      totalBytes: 10,
      expiresAt: Date.now() + 60_000,
    });

    await waitFor(() => {
      expect(projectSkillsApi.importDiscard).toHaveBeenCalledWith(
        expect.anything(),
        "late-token"
      );
    });
    expect(
      screen.queryByText(/Review import|检查导入/)
    ).not.toBeInTheDocument();
  });

  it("provides compact section navigation below the sidebar breakpoint", async () => {
    renderDialog();

    const compactNav = await screen.findByRole("combobox", {
      name: "Settings",
    });
    expect(compactNav).toHaveAttribute("data-testid", "settings-compact-nav");
    expect(compactNav).toHaveTextContent("Projects");

    fireEvent.click(compactNav);
    fireEvent.click(await screen.findByRole("option", { name: "Appearance" }));

    expect(useSettingsDialogStore.getState().activeSection).toBe("appearance");
  });

  it("deletes immediately after the action-scoped confirmation", async () => {
    fixtures.plan = {
      applicable: true,
      blockingIssues: [],
      confirmationRequirements: [
        {
          id: "delete-review-guide",
          kind: "content-delete",
          skillId: "review-guide",
        },
      ],
      observedRevision: "o1",
      planDigest: "digest",
    };
    renderDialog();
    const row = await screen.findByText("demo");
    fireEvent.click(row);
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    const manageBtn = screen
      .getAllByRole("button")
      .find((b) => /open|打开/i.test(b.textContent ?? ""));
    expect(manageBtn).toBeTruthy();
    if (manageBtn) {
      fireEvent.click(manageBtn);
    }
    const deleteBtn = await waitFor(() => {
      const btn = screen
        .getAllByRole("button")
        .find((b) =>
          /delete|删除/i.test(
            b.getAttribute("aria-label") ?? b.textContent ?? ""
          )
        );
      expect(btn).toBeTruthy();
      return btn;
    });
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
    }
    await waitFor(() => expect(projectSkillsApi.apply).toHaveBeenCalled());
    expect(appDialogMocks.showAppConfirm).toHaveBeenCalled();
    const request = (
      projectSkillsApi.apply.mock.calls as unknown as unknown[][]
    ).at(-1)?.[0] as { draft?: { deleteSkillIds?: string[] } } | undefined;
    expect(request?.draft?.deleteSkillIds).toEqual(["review-guide"]);
    expect(useProjectSkillsStore.getState().draft).toBeNull();
  });

  it("does not expose a dirty-draft leave prompt", async () => {
    renderDialog();
    const row = await screen.findByText("demo");
    fireEvent.click(row);
    await waitFor(() => expect(projectSkillsApi.snapshot).toHaveBeenCalled());

    await act(async () => {
      await useSettingsDialogStore
        .getState()
        .requestSectionChange("appearance");
    });
    expect(appDialogMocks.showAppChoice).not.toHaveBeenCalled();
    expect(useSettingsDialogStore.getState().activeSection).toBe("appearance");
  });

  function setActivePanelProject(path: string): void {
    usePanelDescriptorStore.setState({
      activeId: "panel-1",
      descriptors: {
        "panel-1": {
          context: { contextId: "ctx-1", projectRootPath: path, updatedAt: 1 },
          display: { short: "Active Project" },
        },
      },
    } as never);
    useWorkspaceStore.setState({
      api: { activePanel: { id: "panel-1" } } as never,
    });
  }

  it("opens the active project directly even when it is panel-only", async () => {
    fixtures.projectSource = "panel";
    setActivePanelProject("/tmp/demo");
    renderDialog();
    await waitFor(() => {
      expect(projectSkillsApi.projectsSnapshot).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
  });

  it("explicitly indexed active project opens detail directly (v8 §7.1)", async () => {
    fixtures.projectSource = "environment";
    setActivePanelProject("/tmp/demo");
    renderDialog();
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
  });

  it("shows system skills as read-only managed entries", async () => {
    fixtures.skills = [
      ...fixtures.skills,
      {
        id: "pier-canvas",
        enabled: true,
        delivery: null,
        name: "Pier Canvas",
        description: "Canvas capability",
        managedBy: "pier-system",
        contentDigest: `sha256:${"b".repeat(64)}`,
        effects: [],
        issueIds: [],
        fileCount: 1,
        totalBytes: 100,
        riskSummary: null,
        source: { type: "local-import" },
      },
    ];
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => expect(projectSkillsApi.snapshot).toHaveBeenCalled());
    expect(screen.getAllByText("Pier Canvas").length).toBeGreaterThan(0);
    // Enablement lives on the skill detail discovery matrix — list has no Switch.
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("does not render a global Apply bar", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByRole("button", { name: /apply changes|应用更改/i })
    ).toBeNull();
  });

  it("user-global rows render read-only with the user-global badge (v8 §7.3)", async () => {
    fixtures.userGlobalSkills = [
      {
        root: "~/.claude/skills",
        directoryName: "home-guide",
        name: "Home Guide",
        description: "Personal review workflow",
        effects: [
          {
            agentKind: "claude",
            effect: { state: "discoverable", viaRoot: "~/.claude/skills" },
          },
        ],
      },
    ];
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Home Guide").length).toBeGreaterThan(0);
    });
    // Badge + monospace user path are shown.
    expect(screen.getAllByText(/On this Mac|本机全局/).length).toBeGreaterThan(
      0
    );
    expect(
      screen.getAllByText(/~\/\.claude\/skills\/home-guide/).length
    ).toBeGreaterThan(0);
    // Read-only discovery fact: no switch, no open action in project.
    const title = screen.getAllByText("Home Guide")[0];
    const row = title?.closest("li");
    expect(row).toBeTruthy();
    expect(row?.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(row?.querySelectorAll("button")).toHaveLength(0);
  });

  it("managed detail opens directly in the populated editor", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    const manageBtn = screen
      .getAllByRole("button")
      .find((b) => /^(open|打开)$/i.test((b.textContent ?? "").trim()));
    if (!manageBtn) throw new Error("manage button missing");
    fireEvent.click(manageBtn);
    await waitFor(() => {
      expect(projectSkillsApi.skillRead).toHaveBeenCalledWith(
        expect.anything(),
        { kind: "managed", skillId: "review-guide" }
      );
    });
    const editor = await screen.findByRole("textbox", {
      name: /SKILL\.md/i,
    });
    expect(editor.textContent ?? "").toContain("# Home Guide");
    // Discovery channels replace the old "Enable this skill" Switch.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole("switch", { name: /Enable this skill|启用此技能/i })
    ).toBeNull();
  });

  it("filter axis is source-based (v8 §7.3): managed / project / user-global", async () => {
    fixtures.userGlobalSkills = [
      {
        root: "~/.claude/skills",
        directoryName: "home-guide",
        name: "Home Guide",
        description: "Personal review workflow",
        effects: [],
      },
    ];
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    // Source filter chips exist; enabled/disabled/issue chips do not.
    expect(
      screen.getAllByText(/Managed by me|我管理的/).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/^Enabled$|^启用$/)).toBeNull();
    expect(screen.queryByText(/^Has issues$|^有问题$/)).toBeNull();
    // "User global" chip narrows the list to the user-global row.
    const chip = screen
      .getAllByRole("radio")
      .find((el) => /on this mac|本机全局/i.test(el.textContent ?? ""));
    expect(chip).toBeTruthy();
    if (chip) fireEvent.click(chip);
    await waitFor(() => {
      expect(screen.queryByText("Review Guide")).toBeNull();
      expect(screen.getAllByText("Home Guide").length).toBeGreaterThan(0);
    });
  });

  it("review page blocks add on library id conflict (v8 §7.5)", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
    act(() => {
      useProjectSkillsStore.getState().setMode({
        kind: "import-review",
        candidate: {
          token: "tok-1",
          skillId: "review-guide",
          name: "Review Guide",
          description: "conflicting import",
          sourceKind: "local-import",
          sourceDisplayPath: "/tmp/src",
          contentDigest: `sha256:${"c".repeat(64)}`,
          riskFingerprint: "",
          fileCount: 1,
          totalBytes: 10,
          expiresAt: Date.now() + 60_000,
        },
      });
    });
    const addBtn = await waitFor(() => {
      const btn = screen
        .getAllByRole("button")
        .find((b) => /add skill|添加技能/i.test(b.textContent ?? ""));
      expect(btn).toBeTruthy();
      return btn;
    });
    expect(addBtn?.hasAttribute("disabled")).toBe(true);
  });

  it("defers discovery-channel changes until Save on skill detail", async () => {
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    const openBtn = screen
      .getAllByRole("button")
      .find((b) => /^(open|打开)$/i.test((b.textContent ?? "").trim()));
    if (!openBtn) throw new Error("open button missing");
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
    });
    const channelBox = screen.getAllByRole("checkbox")[0];
    expect(channelBox).toBeTruthy();
    if (channelBox) fireEvent.click(channelBox);
    // Selection is draft — no plan/apply until Save.
    expect(projectSkillsApi.apply).not.toHaveBeenCalled();
    const saveBtn = await waitFor(() => {
      const btn = screen
        .getAllByRole("button")
        .find((b) => /save changes|保存更改|保存/i.test(b.textContent ?? ""));
      expect(btn).toBeTruthy();
      expect(btn?.hasAttribute("disabled")).toBe(false);
      return btn;
    });
    if (!saveBtn) throw new Error("save button missing");
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(projectSkillsApi.apply).toHaveBeenCalled();
    });
    expect(appDialogMocks.showAppConfirm).not.toHaveBeenCalled();
    const request = (
      projectSkillsApi.apply.mock.calls.at(-1) as unknown[] | undefined
    )?.[0] as
      | {
          draft?: {
            enabledBySkillId?: Record<string, boolean>;
            deliveryAgents?: boolean;
            deliveryBySkillId?: Record<
              string,
              { agents: boolean; claude: boolean }
            >;
          };
        }
      | undefined;
    expect(request?.draft?.enabledBySkillId?.["review-guide"]).toBe(true);
    expect(request?.draft?.deliveryAgents).toBe(true);
    expect(request?.draft?.deliveryBySkillId?.["review-guide"]).toEqual({
      agents: true,
      claude: false,
    });
    await waitFor(() => {
      expect(useProjectSkillsStore.getState().draft).toBeNull();
    });
  });

  it("rows summarize effects in words, not bare icons", async () => {
    fixtures.skills = [
      {
        ...fixtures.skills[0],
        effects: [
          {
            agentKind: "claude",
            effect: { state: "discoverable", viaRoot: ".agents/skills" },
          },
        ],
      },
      {
        ...fixtures.skills[0],
        id: "silent-guide",
        name: "Silent Guide",
        effects: [],
      },
    ];
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(screen.getAllByText("Review Guide").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByLabelText("Claude").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/\.agents\/skills|个智能体 ·|agent ·/)
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/^Not available to agents$|^未对智能体开放$/).length
    ).toBeGreaterThan(0);
  });

  it("shows action-scoped blocking reasons without a footer", async () => {
    fixtures.plan = {
      applicable: false,
      blockingIssues: [
        { id: "i1", code: "library-drift", skillId: "review-guide" },
      ],
      confirmationRequirements: [],
      observedRevision: "o1",
      planDigest: "digest",
    };
    renderDialog();
    fireEvent.click(await screen.findByText("demo"));
    await waitFor(() => {
      expect(projectSkillsApi.snapshot).toHaveBeenCalled();
    });
    const openBtn = screen
      .getAllByRole("button")
      .find((b) => /^(open|打开)$/i.test((b.textContent ?? "").trim()));
    if (!openBtn) throw new Error("open button missing");
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(2);
    });
    const channelBox = screen.getAllByRole("checkbox")[0];
    if (channelBox) fireEvent.click(channelBox);
    const saveBtn = await waitFor(() => {
      const btn = screen
        .getAllByRole("button")
        .find((b) => /save changes|保存更改/i.test(b.textContent ?? ""));
      expect(btn).toBeTruthy();
      return btn;
    });
    if (saveBtn) fireEvent.click(saveBtn);
    await waitFor(() => expect(appDialogMocks.showAppAlert).toHaveBeenCalled());
    const alertArgs = (
      appDialogMocks.showAppAlert.mock.calls as unknown as unknown[][]
    ).at(-1)?.[0] as { title?: string; body?: string } | undefined;
    expect(alertArgs?.title).toMatch(
      /This action cannot be completed|暂时无法完成此操作/
    );
    expect(alertArgs?.body).toMatch(/Review Guide|review-guide/);
    expect(
      screen.queryByRole("button", { name: /apply changes|应用更改/i })
    ).toBeNull();
  });
});
