import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import { cleanup, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPluginProjectSettingsForTests,
  registerPluginProjectSettings,
} from "@/lib/plugins/project-settings-registry.ts";
import { ProjectsSectionDetail } from "@/pages/settings/components/project/section-detail.tsx";

vi.mock("@/pages/settings/components/environment-editor.tsx", () => ({
  EnvironmentEditor: () => null,
}));
vi.mock("@/pages/settings/components/pier-home-skills-panel.tsx", () => ({
  PierHomeSkillsPanel: () => null,
  isPierHomeSkillsDirty: () => false,
  leavePierHomeSkillsTransientState: async () => true,
}));
vi.mock("@/pages/settings/components/skills/add-menu.tsx", () => ({
  SkillsAddMenu: () => null,
}));
vi.mock("@/pages/settings/components/skills-section.tsx", () => ({
  SkillsSection: () => null,
}));
vi.mock("@/pages/settings/components/project/general-panel.tsx", () => ({
  ProjectGeneralPanel: () => null,
}));
vi.mock("@/pages/settings/components/project/mcp-panel.tsx", () => ({
  ProjectMcpPanel: () => null,
}));

const focused: LocalEnvironmentProject = {
  cleanupCommand: "",
  copyPatterns: [],
  env: {},
  kind: "project",
  projectRootPath: "/repo",
  setupCommand: "",
  updatedAt: 1,
};

const t = ((key: string) => key) as TFunction;
const editorRef = createRef<null>();

function registerDemoTab() {
  registerPluginProjectSettings({
    id: "pier.demo.project",
    render: ({ projectRootPath }) => (
      <div data-testid="plugin-project-tab">{projectRootPath}</div>
    ),
    title: () => "Project Memory",
    visible: ({ isPierHome }) => !isPierHome,
  });
}

afterEach(() => {
  cleanup();
});

describe("ProjectsSectionDetail plugin tabs", () => {
  beforeEach(() => {
    clearPluginProjectSettingsForTests();
  });

  it("shows a registered plugin tab and renders its body", () => {
    registerDemoTab();
    render(
      <ProjectsSectionDetail
        activeProjectRootPath={null}
        editorRef={editorRef}
        envDirty={false}
        focused={focused}
        onBack={vi.fn()}
        onDelete={vi.fn()}
        onDirtyChange={vi.fn()}
        onTabChange={vi.fn()}
        projectsTab="pier.demo.project"
        skillsModeKind="detail"
        t={t}
        triggerEnvSave={vi.fn()}
      />
    );
    expect(screen.getByRole("tab", { name: "Project Memory" })).toBeTruthy();
    expect(screen.getByTestId("plugin-project-tab").textContent).toBe("/repo");
  });

  it("orders plugin tabs before the general tab (danger zone stays last)", () => {
    registerDemoTab();
    render(
      <ProjectsSectionDetail
        activeProjectRootPath={null}
        editorRef={editorRef}
        envDirty={false}
        focused={focused}
        onBack={vi.fn()}
        onDelete={vi.fn()}
        onDirtyChange={vi.fn()}
        onTabChange={vi.fn()}
        projectsTab="skills"
        skillsModeKind="detail"
        t={t}
        triggerEnvSave={vi.fn()}
      />
    );
    const names = screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent ?? "");
    expect(names.indexOf("Project Memory")).toBeGreaterThan(
      names.indexOf("settings.projects.tabMcp")
    );
    expect(names.indexOf("Project Memory")).toBeLessThan(
      names.indexOf("settings.projects.tabGeneral")
    );
    expect(names.at(-1)).toBe("settings.projects.tabGeneral");
  });

  it("hides the plugin tab on Pier Home", () => {
    registerDemoTab();
    render(
      <ProjectsSectionDetail
        activeProjectRootPath={null}
        editorRef={editorRef}
        envDirty={false}
        focused={{ ...focused, kind: "pier-home" }}
        onBack={vi.fn()}
        onDelete={vi.fn()}
        onDirtyChange={vi.fn()}
        onTabChange={vi.fn()}
        projectsTab="skills"
        skillsModeKind="detail"
        t={t}
        triggerEnvSave={vi.fn()}
      />
    );
    expect(screen.queryByRole("tab", { name: "Project Memory" })).toBeNull();
    expect(screen.queryByTestId("plugin-project-tab")).toBeNull();
  });
});
