// @vitest-environment node
/**
 * 进程级启动锁：`pnpm dev:relay` 必须能 listen + /healthz。
 * 单测走 vitest 别名，挡不住 Node 原生不认 `@shared`（内部服务验证缺口）。
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRelayConfig } from "../../../apps/relay/src/config.ts";

const REPO_ROOT = process.cwd();

function parseDevRelayArgs(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  const script = pkg.scripts["dev:relay"] ?? "";
  expect(script, "package.json scripts.dev:relay").toMatch(/^node /);
  return script.split(/\s+/).slice(1);
}

describe("loadRelayConfig", () => {
  it("RELAY_PORT=0 表示系统分配端口（进程冒烟用）", () => {
    expect(loadRelayConfig({ RELAY_PORT: "0" }).port).toBe(0);
  });

  it("非端口整数仍拒绝 0", () => {
    expect(() => loadRelayConfig({ RELAY_FRAMES_PER_SECOND: "0" })).toThrow(
      /invalid RELAY_FRAMES_PER_SECOND/
    );
  });
});

describe("pnpm dev:relay 进程启动", () => {
  it("listen 后 GET /healthz 为 200 { ok: true }", async () => {
    const child = spawn(process.execPath, parseDevRelayArgs(), {
      cwd: REPO_ROOT,
      env: { ...process.env, RELAY_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const ready = await new Promise<{ port: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`relay did not become ready: ${stdout}`));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(
          new Error(`relay exited before ready code=${code} signal=${signal}`)
        );
      });
      child.stdout?.on("data", () => {
        for (const line of stdout.split("\n")) {
          if (!line.includes("relay.ready")) {
            continue;
          }
          try {
            const parsed = JSON.parse(line) as {
              event?: string;
              port?: number;
            };
            if (
              parsed.event === "relay.ready" &&
              typeof parsed.port === "number"
            ) {
              clearTimeout(timer);
              child.removeAllListeners("exit");
              resolve({ port: parsed.port });
              return;
            }
          } catch {
            // 非 JSON 行忽略（strip-types 警告等）
          }
        }
      });
    });

    try {
      expect(ready.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${ready.port}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });
});
