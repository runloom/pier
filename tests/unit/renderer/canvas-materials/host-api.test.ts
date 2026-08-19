import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANVAS_HOST_ALLOWED_CHANNELS,
  CANVAS_HOST_ALLOWED_COMMANDS,
  CANVAS_HOST_SNAPSHOT_IDS,
  type CanvasHostCommandType,
  canvasHostInspect,
} from "@shared/contracts/canvas-host.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { describe, expect, it } from "vitest";
import {
  canvasHostApiDomains,
  listPierCommandTypes,
  projectHostApiDomains,
} from "@/lib/canvas-host/domains.ts";
import { decorateCanvasHostInspect } from "@/lib/canvas-host/inspect.ts";
import { hostApiSystemMaterials } from "@/lib/canvas-materials/host-api-catalog.ts";

describe("host API materials projection", () => {
  it("covers every PierCommand type exactly once", () => {
    const types = listPierCommandTypes();
    expect(types.length).toBe(pierCommandSchema.options.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it("covers every broadcast channel", () => {
    const channels = new Set(
      projectHostApiDomains().flatMap((domain) =>
        domain.events.map((event) => event.channel)
      )
    );
    for (const channel of Object.values(PIER_BROADCAST)) {
      expect(channels.has(channel), channel).toBe(true);
    }
  });

  it("keeps file, git, and activity as capability domains", () => {
    const ids = projectHostApiDomains().map((domain) => domain.id);
    expect(ids).toContain("file");
    expect(ids).toContain("git");
    expect(ids).toContain("terminal");
    expect(ids).toContain("foreground-activity");
    expect(ids).toContain("resources");
    expect(ids).toContain("usage-data");
    const file = projectHostApiDomains().find((domain) => domain.id === "file");
    expect(file?.commands.some((command) => command.type === "file.list")).toBe(
      true
    );
    expect(
      file?.events.some((event) => event.channel === "pier://file:changed")
    ).toBe(true);
  });

  it("lists only the canvas-allowed Host API in materials", () => {
    const domains = canvasHostApiDomains();
    const commands = domains
      .flatMap((domain) => domain.commands.map((command) => command.type))
      .sort();
    const broadcasts = domains
      .flatMap((domain) =>
        domain.events
          .filter((event) => event.kind === "broadcast")
          .map((event) => event.channel)
      )
      .sort();
    const snapshots = domains
      .flatMap((domain) =>
        domain.events
          .filter((event) => event.kind === "snapshot")
          .map((event) => event.channel)
      )
      .sort();
    expect(commands).toEqual([...CANVAS_HOST_ALLOWED_COMMANDS].sort());
    expect(broadcasts).toEqual([...CANVAS_HOST_ALLOWED_CHANNELS].sort());
    expect(snapshots).toEqual([...CANVAS_HOST_SNAPSHOT_IDS].sort());
    expect(commands).not.toContain("file.writeText");
    expect(commands).not.toContain("window.close");
    expect(broadcasts).not.toContain(PIER_BROADCAST.COMMENTS_CHANGED);
    expect(broadcasts).not.toContain(PIER_BROADCAST.SETTINGS_OPEN_REQUEST);
    const file = domains.find((domain) => domain.id === "file");
    expect(file?.commands.some((command) => command.type === "file.list")).toBe(
      true
    );
    expect(
      file?.commands.some((command) => command.type === "file.writeText")
    ).toBe(false);
    const materials = hostApiSystemMaterials();
    expect(materials.map((row) => row.id).sort()).toEqual(
      domains.map((domain) => domain.id).sort()
    );
    const fileMaterial = materials.find((row) => row.id === "file");
    expect(fileMaterial?.usage).toContain("file.list");
    expect(fileMaterial?.usage).toContain("root:");
    expect(fileMaterial?.usage).toContain("path:");
    expect(fileMaterial?.usage).not.toContain("file.drafts.get");
    const gitMaterial = materials.find((row) => row.id === "git");
    expect(gitMaterial?.usage).toContain("git.getStatus");
    expect(gitMaterial?.usage).not.toContain("git.getDiffPatch");
    const activity = materials.find((row) => row.id === "foreground-activity");
    expect(activity?.usage).toContain('useHostSnapshot("foreground-activity")');
    expect(activity?.importLine).toContain("useHostSnapshot");
    expect(activity?.signature).toContain(
      'host.snapshot("foreground-activity")'
    );
  });

  it("keeps inspect domains aligned with canvas materials", () => {
    expect(
      canvasHostInspect()
        .domains.map((domain) => domain.id)
        .sort()
    ).toEqual(
      canvasHostApiDomains()
        .map((domain) => domain.id)
        .sort()
    );
  });

  it("fills command payload fields on the runtime inspect", () => {
    const decorated = decorateCanvasHostInspect(canvasHostInspect());
    const byType = new Map(
      decorated.domains.flatMap((domain) =>
        domain.commands.map((command) => [command.type, command] as const)
      )
    );
    for (const type of CANVAS_HOST_ALLOWED_COMMANDS) {
      expect(byType.has(type), type).toBe(true);
    }
    const file = decorated.domains.find((domain) => domain.id === "file");
    const list = file?.commands.find((command) => command.type === "file.list");
    expect(list?.fields.map((field) => field.name).sort()).toEqual([
      "path",
      "root",
    ]);
    expect(list?.fields.every((field) => field.optional === false)).toBe(true);
    expect(file?.exemplar).toBe("file.list");
    const git = decorated.domains.find((domain) => domain.id === "git");
    expect(git?.exemplar).toBe("git.getStatus");
    const search = git?.commands.find(
      (command) => command.type === "git.searchBranches"
    );
    const options = search?.fields.find((field) => field.name === "options");
    expect(options?.optional).toBe(true);
    expect(options?.type).toContain("| null");
    expect(options?.type).toContain("| undefined");
    const branches = git?.commands.find(
      (command) => command.type === "git.listBranches"
    );
    const branchOptions = branches?.fields.find(
      (field) => field.name === "options"
    );
    expect(branchOptions?.optional).toBe(false);
    expect(branchOptions?.type).toContain("kind:");
  });

  it("throws when inspect lists a command with no schema fields", () => {
    const inspected = canvasHostInspect();
    const fileDomain = inspected.domains.find((domain) => domain.id === "file");
    if (!fileDomain) {
      throw new Error("expected file inspect domain");
    }
    expect(() =>
      decorateCanvasHostInspect({
        ...inspected,
        domains: [
          {
            ...fileDomain,
            commands: [
              { fields: [], type: "file.list" },
              {
                fields: [],
                type: "file.writeText" as CanvasHostCommandType,
              },
            ],
          },
        ],
      })
    ).toThrow(/missing payload fields for file.writeText/);
  });

  it("keeps runtime inspect off the materials catalog module", () => {
    const root = process.cwd();
    const hostRuntime = readFileSync(
      join(root, "src/renderer/lib/live-modules/host.ts"),
      "utf8"
    );
    const canvasesTsconfig = readFileSync(
      join(root, "tsconfig.canvases.json"),
      "utf8"
    );
    expect(hostRuntime).toContain('from "@/lib/canvas-host/inspect.ts"');
    expect(hostRuntime).not.toContain("canvas-materials");
    expect(canvasesTsconfig).toContain(
      "resources/system-skills/pier-canvas/sdk/host.d.ts"
    );
    expect(canvasesTsconfig).not.toContain("tests/support/pier-host.ts");
  });
});
