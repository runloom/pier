import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_MATERIAL_GROUPS } from "@/lib/canvas-materials/groups.ts";
import { isTabAllowedForProject } from "@/pages/settings/components/project/section-helpers.ts";
import { NAV_ITEMS } from "@/pages/settings/data/appearance-nav.ts";
import {
  PROJECTS_SECTION_ALIASES,
  projectsTabFromSection,
} from "@/pages/settings/data/projects-settings.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

const ROOT = process.cwd();
const KIT_CANVAS = join(
  ROOT,
  ".pier/canvases/canvas-kit/canvas-kit.canvas.tsx"
);

describe("canvas materials discovery", () => {
  it("is not a settings nav section or project tab", () => {
    expect(NAV_ITEMS.map((item) => item.id)).not.toContain("materials");
    expect(projectsTabFromSection("materials")).toBeNull();
    expect(PROJECTS_SECTION_ALIASES).toContain("materials");
  });

  it("keeps the materials alias opening the projects shell without selecting a tab", () => {
    useSettingsDialogStore.setState({
      projectsFocusHome: false,
      projectsFocusPath: "/some/project",
      projectsTab: "skills",
    });
    useSettingsDialogStore.getState().openSection("materials");
    const state = useSettingsDialogStore.getState();
    expect(state.activeSection).toBe("projects");
    expect(state.projectsTab).toBe("skills");
    expect(state.isOpen).toBe(true);
  });

  it("does not show a materials tab on Pier Home or repo projects", () => {
    expect(isTabAllowedForProject("materials", true)).toBe(false);
    expect(isTabAllowedForProject("materials", false)).toBe(false);
    expect(isTabAllowedForProject("skills", true)).toBe(true);
    expect(isTabAllowedForProject("mcp", true)).toBe(true);
    expect(isTabAllowedForProject("environment", true)).toBe(false);
    expect(isTabAllowedForProject("general", true)).toBe(false);
    expect(isTabAllowedForProject("skills", false)).toBe(true);
    expect(isTabAllowedForProject("environment", false)).toBe(true);
  });

  it("does not mount a materials panel in project settings", () => {
    const detail = readFileSync(
      join(
        ROOT,
        "src/renderer/pages/settings/components/project/section-detail.tsx"
      ),
      "utf8"
    );
    expect(detail).not.toContain("MaterialsPanel");
    expect(detail).not.toContain("tabMaterials");
    expect(detail).not.toContain("components/project/materials");
  });

  it("ships the interim catalog as a kit canvas", () => {
    expect(existsSync(KIT_CANVAS)).toBe(true);
    const source = readFileSync(KIT_CANVAS, "utf8");
    expect(source).toContain('kind: "kit"');
    expect(source).toContain("画布物料");
    expect(source).toContain('from "pier/canvas"');
    expect(source).not.toContain("window.pier");
  });

  it("shows every cataloged material on the kit canvas", () => {
    const dir = join(ROOT, ".pier/canvases/canvas-kit");
    const source = readdirSync(dir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    const hostPage = readFileSync(join(dir, "host.tsx"), "utf8");
    const filesSdk = readFileSync(
      join(ROOT, "resources/system-skills/pier-canvas/sdk/files.d.ts"),
      "utf8"
    );
    for (const group of CANVAS_MATERIAL_GROUPS) {
      if (group.family === "data") {
        expect(source, group.id).toContain(group.members[0]);
        continue;
      }
      expect(source, group.id).toContain(`name="${group.id}"`);
    }
    expect(source).toContain("host.inspect()");
    expect(source).toContain("host.invoke");
    expect(source).toContain("useHostSnapshot");
    expect(source).toContain("function useCanvasFile(): CanvasFileApi");
    expect(source).toContain("interface CanvasFileReadResult");
    expect(filesSdk).toContain("export const useCanvasFile:");
    expect(filesSdk).toContain("interface CanvasFileReadResult");
    expect(source).toContain(">API</TabsTrigger>");
    expect(source).not.toContain(">文件</TabsTrigger>");
    expect(source).not.toContain("宿主 API");
    expect(source).not.toContain("命令参考");
    expect(hostPage).toContain("ItemGroup");
    expect(hostPage).toContain("inspect.domains");
    expect(hostPage).toContain('name: "useCanvasFile"');
    expect(hostPage).toContain('kind: "file-api"');
    expect(hostPage).toContain("aria-pressed");
    expect(hostPage).not.toContain("<Select");
    expect(hostPage).not.toContain("SelectTrigger");
    expect(hostPage).toContain('type: "file.list"');
    expect(hostPage).toContain("root: workspaceRoot");
    expect(hostPage).toContain('path: "."');
    const hostDomain = readFileSync(join(dir, "host-domain.tsx"), "utf8");
    expect(hostDomain).toContain("domain.exemplar");
    expect(hostDomain).not.toContain('field.type.includes("undefined")');
    expect(hostDomain).not.toContain("!command && !snapshot");
  });

  it("does not add files to the settings/components density root", () => {
    const dir = join(ROOT, "src/renderer/pages/settings/components");
    const direct = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name));
    expect(direct.length).toBeLessThanOrEqual(39);
    expect(direct).not.toContain("materials-panel.tsx");
  });
});
