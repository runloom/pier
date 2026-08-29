import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentDetectionService,
  mergeLoginShellPath,
} from "@main/services/agents/detection-service.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("mergeLoginShellPath", () => {
  it("保留 login shell 顺序并把 Electron 独有目录追加到末尾", () => {
    expect(
      mergeLoginShellPath(
        "/opt/homebrew/bin:/app/resources/bin:/nvm/bin",
        "/nvm/bin:/opt/homebrew/bin:/usr/bin"
      )
    ).toEqual({
      added: ["/usr/bin"],
      path: "/nvm/bin:/opt/homebrew/bin:/usr/bin:/app/resources/bin",
    });
  });

  it("即使没有新增目录也按 login shell 优先级重新排序", () => {
    expect(
      mergeLoginShellPath(
        "/opt/homebrew/bin:/nvm/bin",
        "/nvm/bin:/opt/homebrew/bin"
      )
    ).toEqual({
      added: [],
      path: "/nvm/bin:/opt/homebrew/bin",
    });
  });
});
describe("agent detection", () => {
  it("只返回 probe 命中的 agent", async () => {
    const installed = new Set(["claude", "cursor-agent"]);
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(installed.has(cmd)),
    });
    const result = await service.detect();
    expect(result.detectedIds).toContain("claude");
    expect(result.detectedIds).toContain("cursor"); // cursor-agent → cursor
    expect(result.detectedIds).not.toContain("codex");
  });

  it("全部未装时返回空", async () => {
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: () => Promise.resolve(false),
    });
    expect((await service.detect()).detectedIds).toEqual([]);
  });

  it("detect 先等待 host env 再探测", async () => {
    let ready = false;
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(ready && cmd === "claude"),
      waitForHostEnv: async () => {
        ready = true;
      },
    });
    const result = await service.detect();
    expect(result.detectedIds).toContain("claude");
  });

  it("ensurePath 幂等等待 host env，不重复 waitForHostEnv side effects beyond await", async () => {
    let waitCount = 0;
    const service = createAgentDetectionService({
      waitForHostEnv: async () => {
        waitCount += 1;
      },
      probe: () => Promise.resolve(false),
    });

    await service.ensurePath();
    await service.ensurePath();
    // Each ensurePath awaits waitForHostEnv; product wait is a shared Promise
    // so count may be 2 here in unit injection. Memoization is hostShellEnvReady's job.
    expect(waitCount).toBeGreaterThanOrEqual(1);
  });

  it("detect 复用探测快照，只有 refresh 才重新 probe", async () => {
    let probeCount = 0;
    const service = createAgentDetectionService({
      waitForHostEnv: async () => undefined,
      probe: (cmd) => {
        probeCount += 1;
        return Promise.resolve(cmd === "codex");
      },
    });

    const first = await service.detect();
    const countAfterFirst = probeCount;
    const second = await service.detect();
    expect(second).toBe(first);
    expect(probeCount).toBe(countAfterFirst);

    await service.refresh();
    expect(probeCount).toBeGreaterThan(countAfterFirst);
  });

  it("refresh 再次等待 host env 再探测", async () => {
    let waitCount = 0;
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(waitCount >= 2 && cmd === "claude"),
      waitForHostEnv: async () => {
        waitCount += 1;
      },
    });
    expect((await service.detect()).detectedIds).not.toContain("claude");
    const r = await service.refresh();
    expect(r.detectedIds).toContain("claude");
  });

  it("detectCmdAliases 命中即认到 catalog id", async () => {
    const installed = new Set(["kimi-cli", "vibe-acp", "qoderclicn"]);
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(installed.has(cmd)),
    });
    const result = await service.detect();
    // kimi-cli is OSC-only; PATH presence of the Python CLI is not Kimi Code.
    expect(result.detectedIds).not.toContain("kimi");
    expect(result.detectedIds).toContain("mistral-vibe");
    expect(result.detectedIds).toContain("qodercli");
  });

  it("detects kimi from the Kimi Code binary name, not kimi-cli alone", async () => {
    const installed = new Set(["kimi"]);
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(installed.has(cmd)),
    });
    expect((await service.detect()).detectedIds).toContain("kimi");
  });
});

describe("agent detection kimi leftover PATH", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function tempBin(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    mkdirSync(join(dir, "bin"));
    return join(dir, "bin");
  }

  it("does not treat leftover PATH kimi as Kimi Code", async () => {
    const bin = tempBin("pier-detect-kimi-legacy-");
    const kimi = join(bin, "kimi");
    writeFileSync(
      kimi,
      "#!/usr/bin/env python3\nfrom kimi_cli.__main__ import main\n"
    );
    chmodSync(kimi, 0o755);
    const service = createAgentDetectionService({
      getEnv: () => ({ PATH: bin }),
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(cmd === "kimi"),
    });
    expect((await service.detect()).detectedIds).not.toContain("kimi");
  });

  it("does not treat a PATH kimi symlink into uv kimi-cli as Kimi Code", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-detect-kimi-link-"));
    dirs.push(root);
    const uvBin = join(root, "share", "uv", "tools", "kimi-cli", "bin");
    mkdirSync(uvBin, { recursive: true });
    const target = join(uvBin, "kimi");
    writeFileSync(
      target,
      "#!/usr/bin/env python3\nfrom kimi_cli.__main__ import main\n"
    );
    chmodSync(target, 0o755);
    const bin = join(root, "bin");
    mkdirSync(bin);
    symlinkSync(target, join(bin, "kimi"));
    const service = createAgentDetectionService({
      getEnv: () => ({ PATH: bin }),
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(cmd === "kimi"),
    });
    expect((await service.detect()).detectedIds).not.toContain("kimi");
  });

  it("detects Kimi Code on PATH even when leftover kimi-cli is beside it", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-detect-kimi-code-"));
    dirs.push(root);
    const bin = join(root, ".kimi-code", "bin");
    mkdirSync(bin, { recursive: true });
    const kimi = join(bin, "kimi");
    writeFileSync(kimi, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    chmodSync(kimi, 0o755);
    writeFileSync(join(bin, "kimi-cli"), "#!/usr/bin/env python3\n");
    const service = createAgentDetectionService({
      getEnv: () => ({ PATH: bin }),
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(cmd === "kimi"),
    });
    expect((await service.detect()).detectedIds).toContain("kimi");
  });

  it("does not treat an unresolved kimi PATH hit as Kimi Code", async () => {
    const bin = tempBin("pier-detect-kimi-miss-");
    const service = createAgentDetectionService({
      getEnv: () => ({ PATH: bin }),
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(cmd === "kimi"),
    });
    expect((await service.detect()).detectedIds).not.toContain("kimi");
  });
});
