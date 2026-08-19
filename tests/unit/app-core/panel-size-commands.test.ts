import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authorizeCommand } from "@main/app-core/permissions.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

const now = 1_772_000_000_000;

function client(
  kind: PierClient["kind"],
  capabilities = DEFAULT_CAPABILITIES_BY_CLIENT_KIND[kind]
): PierClient {
  return {
    capabilities,
    createdAt: now,
    id: `${kind}-1`,
    kind,
    lastSeenAt: now,
  };
}

describe("panel size commands", () => {
  it("authorizes cli-local via panel:control", () => {
    expect(
      authorizeCommand(
        { panelId: "p1", type: "panel.setSize", widthRatio: 0.3 },
        client("cli-local")
      )
    ).toEqual({ ok: true });
    expect(
      authorizeCommand(
        {
          axis: "vertical",
          panelIds: ["p1"],
          type: "panel.equalize",
        },
        client("cli-local")
      )
    ).toEqual({ ok: true });
  });

  it("rejects schema without a ratio, ratio=1, or empty panelIds", () => {
    expect(
      pierCommandSchema.safeParse({ panelId: "p1", type: "panel.setSize" })
        .success
    ).toBe(false);
    expect(
      pierCommandSchema.safeParse({
        panelId: "p1",
        type: "panel.setSize",
        widthRatio: 1,
      }).success
    ).toBe(false);
    expect(
      pierCommandSchema.safeParse({
        axis: "horizontal",
        panelIds: [],
        type: "panel.equalize",
      }).success
    ).toBe(false);
  });

  it("does not route size commands through resolvePanelForWrite", () => {
    const source = readFileSync(
      join(process.cwd(), "src/main/app-core/commands/panel-size.ts"),
      "utf8"
    );
    expect(source).not.toContain("resolvePanelForWrite");
    expect(source).toContain("rendererCommand.execute");
  });
});
