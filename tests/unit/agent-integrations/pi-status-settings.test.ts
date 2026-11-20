import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pierManagedPluginMarker } from "../../../src/main/services/agents/integrations/managed-plugin-file.ts";
import {
  isStatusExtensionEnabled,
  readStatusHooksDisabledByConfig,
} from "../../../src/main/services/agents/integrations/pi.ts";

const AGENT_DIR = "/home/tester/.pi/agent";
const EXTENSION_PATH = join(AGENT_DIR, "extensions", "pier-agent-status.ts");

describe("isStatusExtensionEnabled", () => {
  it("enables the extension when pi has no overrides", () => {
    expect(isStatusExtensionEnabled(undefined, EXTENSION_PATH, AGENT_DIR)).toBe(
      true
    );
    expect(isStatusExtensionEnabled([], EXTENSION_PATH, AGENT_DIR)).toBe(true);
  });

  it("honors a relative force-exclude override", () => {
    expect(
      isStatusExtensionEnabled(
        ["extensions/other.ts", "-extensions/pier-agent-status.ts"],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(false);
  });

  it("honors absolute and ./ force-exclude overrides", () => {
    expect(
      isStatusExtensionEnabled([EXTENSION_PATH], EXTENSION_PATH, AGENT_DIR)
    ).toBe(true);
    expect(
      isStatusExtensionEnabled(
        [`-${EXTENSION_PATH}`],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(false);
    expect(
      isStatusExtensionEnabled(
        ["-./extensions/pier-agent-status.ts"],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(false);
  });

  it("applies excludes, force-includes, then force-excludes", () => {
    const relative = "extensions/pier-agent-status.ts";
    expect(
      isStatusExtensionEnabled(["!extensions/*.ts"], EXTENSION_PATH, AGENT_DIR)
    ).toBe(false);
    expect(
      isStatusExtensionEnabled(
        ["!extensions/*.ts", `+${relative}`],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(true);
    expect(
      isStatusExtensionEnabled(
        ["!extensions/*.ts", `+${relative}`, `-${relative}`],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(false);
  });

  it("normalizes ~, file:// and ./ before matching", () => {
    expect(
      isStatusExtensionEnabled(
        ["-~/.pi/agent/extensions/pier-agent-status.ts"],
        EXTENSION_PATH,
        AGENT_DIR,
        "/home/tester"
      )
    ).toBe(false);
    expect(
      isStatusExtensionEnabled(
        [`-file://${EXTENSION_PATH}`],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(false);
  });

  it("leaves the extension enabled for unrelated patterns", () => {
    expect(
      isStatusExtensionEnabled(
        ["!extensions/orca-*.ts", "-extensions/superset-hooks.ts"],
        EXTENSION_PATH,
        AGENT_DIR
      )
    ).toBe(true);
  });
});

describe("readStatusHooksDisabledByConfig", () => {
  it("reports an excluded managed extension", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-pi-settings-"));
    await mkdir(join(home, "extensions"), { recursive: true });
    await writeFile(
      join(home, "extensions", "pier-agent-status.ts"),
      `// ${pierManagedPluginMarker()}\nexport default function () {}`
    );
    await writeFile(
      join(home, "settings.json"),
      JSON.stringify({
        extensions: [
          "-extensions/superset-hooks.ts",
          "-extensions/pier-agent-status.ts",
        ],
      })
    );

    await expect(
      readStatusHooksDisabledByConfig({
        HOME: home,
        PI_CODING_AGENT_DIR: home,
      })
    ).resolves.toBe(true);
  });

  it("ignores an unmanaged file at the extension path", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-pi-settings-"));
    await mkdir(join(home, "extensions"), { recursive: true });
    await writeFile(
      join(home, "extensions", "pier-agent-status.ts"),
      "export default function () {}"
    );
    await writeFile(
      join(home, "settings.json"),
      JSON.stringify({ extensions: ["-extensions/pier-agent-status.ts"] })
    );

    await expect(
      readStatusHooksDisabledByConfig({
        HOME: home,
        PI_CODING_AGENT_DIR: home,
      })
    ).resolves.toBe(false);
  });

  it("treats missing or malformed settings as enabled", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-pi-settings-"));
    await expect(
      readStatusHooksDisabledByConfig({
        HOME: home,
        PI_CODING_AGENT_DIR: home,
      })
    ).resolves.toBe(false);

    await mkdir(join(home, "extensions"), { recursive: true });
    await writeFile(
      join(home, "extensions", "pier-agent-status.ts"),
      `// ${pierManagedPluginMarker()}\nexport default function () {}`
    );
    await writeFile(join(home, "settings.json"), "{oops");
    await expect(
      readStatusHooksDisabledByConfig({
        HOME: home,
        PI_CODING_AGENT_DIR: home,
      })
    ).resolves.toBe(false);
  });
});
