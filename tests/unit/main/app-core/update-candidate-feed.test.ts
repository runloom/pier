import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  feedConfigForTarget,
  fetchHostReleaseTags,
  HOST_RELEASE_OWNER,
  HOST_RELEASE_REPO,
  pickHostUpdateTarget,
} from "@main/services/app-updates/candidate-feed.ts";
import { describe, expect, it, vi } from "vitest";

describe("pickHostUpdateTarget", () => {
  it("ignores plugin and malformed tags", () => {
    expect(
      pickHostUpdateTarget(
        ["plugin-codex-v9.9.9", "plugin-grok-v1.0.1", "nightly", ""],
        "0.1.0"
      )
    ).toEqual({ kind: "latest" });
  });

  it("stays on Latest when the newest host tag is stable", () => {
    expect(
      pickHostUpdateTarget(
        ["v0.2.0", "v0.2.0-rc.2", "plugin-codex-v9.9.9", "v0.1.9"],
        "0.1.9"
      )
    ).toEqual({ kind: "latest" });
  });

  it("targets the newest candidate when it beats the current version", () => {
    expect(
      pickHostUpdateTarget(
        ["plugin-ssh-v2.0.0", "v0.2.0-rc.1", "v0.2.0-rc.2", "v0.1.9"],
        "0.1.9"
      )
    ).toEqual({ kind: "candidate", tag: "v0.2.0-rc.2" });
  });

  it("stays on Latest when the newest candidate is not newer than current", () => {
    expect(
      pickHostUpdateTarget(["v0.2.0-rc.2", "v0.1.9"], "0.2.0-rc.2")
    ).toEqual({ kind: "latest" });
    expect(pickHostUpdateTarget(["v0.2.0-rc.2"], "0.2.0")).toEqual({
      kind: "latest",
    });
  });

  it("stays on Latest when no host tags exist", () => {
    expect(pickHostUpdateTarget([], "0.1.0")).toEqual({ kind: "latest" });
  });
});

describe("feedConfigForTarget", () => {
  it("pins candidates to the tag download URL via generic provider", () => {
    expect(
      feedConfigForTarget({ kind: "candidate", tag: "v0.2.0-rc.1" })
    ).toEqual({
      provider: "generic",
      url: `https://github.com/${HOST_RELEASE_OWNER}/${HOST_RELEASE_REPO}/releases/download/v0.2.0-rc.1`,
    });
  });

  it("restores the GitHub Latest provider for stable targets", () => {
    expect(feedConfigForTarget({ kind: "latest" })).toEqual({
      owner: HOST_RELEASE_OWNER,
      provider: "github",
      repo: HOST_RELEASE_REPO,
    });
  });
});

describe("fetchHostReleaseTags", () => {
  it("returns non-draft tag names from a single non-full page", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { draft: false, tag_name: "v0.2.0-rc.1" },
            { draft: true, tag_name: "v0.3.0" },
            { draft: false, tag_name: "plugin-codex-v1.0.0" },
            { draft: false },
          ]),
          { status: 200 }
        )
    );
    await expect(fetchHostReleaseTags({ fetchImpl })).resolves.toEqual([
      "v0.2.0-rc.1",
      "plugin-codex-v1.0.0",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/${HOST_RELEASE_OWNER}/${HOST_RELEASE_REPO}/releases?per_page=100&page=1`,
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "pier-app-update" }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("fetches the second page when plugin releases fill the first page", async () => {
    const pluginPage = Array.from({ length: 100 }, (_, i) => ({
      draft: false,
      tag_name: `plugin-codex-v1.0.${i}`,
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(pluginPage), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ draft: false, tag_name: "v0.2.0-rc.3" }]),
          { status: 200 }
        )
      );
    const tags = await fetchHostReleaseTags({ fetchImpl });
    expect(tags).toContain("v0.2.0-rc.3");
    expect(tags).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      expect.stringContaining("per_page=100&page=2"),
      expect.anything()
    );
  });

  it("stops at the first page once a host tag is visible", async () => {
    const fullPageWithHost = [
      { draft: false, tag_name: "v0.2.0-rc.1" },
      ...Array.from({ length: 99 }, (_, i) => ({
        draft: false,
        tag_name: `plugin-grok-v2.0.${i}`,
      })),
    ];
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(fullPageWithHost), { status: 200 })
    );
    const tags = await fetchHostReleaseTags({ fetchImpl });
    expect(tags).toContain("v0.2.0-rc.1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("rate limited", {
          status: 403,
        })
    );
    await expect(fetchHostReleaseTags({ fetchImpl })).rejects.toThrow(/403/);
  });

  it("throws on non-array payloads", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "oops" }), {
          status: 200,
        })
    );
    await expect(fetchHostReleaseTags({ fetchImpl })).rejects.toThrow(
      /non-array/
    );
  });
});

describe("electron-updater adapter guard", () => {
  it("forces allowPrerelease off (rc builds auto-enable it at construction)", async () => {
    const source = await readFile(
      join(
        process.cwd(),
        "src/main/services/app-updates/electron-updater-adapter.ts"
      ),
      "utf8"
    );
    expect(source).toContain("autoUpdater.allowPrerelease = false");
  });
});
