import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control-server.ts";
import { pierCommandEnvelopeSchema } from "@shared/contracts/commands.ts";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-cli-bin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("bin/pier.mjs", () => {
  it("解析 status 并输出命令信封", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "status",
      "--json",
      "--print-envelope",
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      envelope: {
        clientId: "cli-local",
        command: { type: "app.status" },
        protocolVersion: 1,
      },
      json: true,
    });
    expect(parsed.envelope.requestId).toEqual(expect.any(String));
  });

  it("忽略 pnpm 传入的前导 -- 分隔符", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "--",
      "open",
      ".",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: { path: ".", type: "workspace.open" },
      },
      json: true,
    });
  });

  it("解析窗口和分屏参数", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "open",
      ".",
      "--window",
      "main",
      "--split",
      "below",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: {
          path: ".",
          placement: "split-below",
          type: "workspace.open",
          windowId: "main",
        },
      },
      json: true,
    });
  });

  it("解析 --no-focus", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/pier.mjs",
      "open",
      ".",
      "--no-focus",
      "--json",
      "--print-envelope",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      envelope: {
        command: {
          focus: false,
          path: ".",
          type: "workspace.open",
        },
      },
      json: true,
    });
  });

  it("没有 --json 时成功不输出内容", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        return Promise.resolve({
          data: null,
          ok: true,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });
    await server.start();

    const { stdout } = await execFileAsync("node", ["bin/pier.mjs", "status"], {
      env: { ...process.env, PIER_CONTROL_SOCKET_PATH: socketPath },
    });

    expect(stdout).toBe("");
    await server.close();
  });
});
