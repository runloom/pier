#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * local-control 冒烟（需 Pier 已起 + socket）：
 * status/snapshot → cli-human agents.start/turn/screen → snapshot.runtimes
 * → watch 错 boot → agents.invoke unsupported
 *
 * 环境：
 *   PIER_USER_DATA_DIR  与 Electron --user-data-dir 一致
 *   PIER_ROOT           仓库根（默认 cwd）
 *
 *   node scripts/w6-live-control-smoke.mjs
 */
import { createHash as hash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.PIER_ROOT || process.cwd();

function shortHash(input) {
  return hash("sha256").update(input).digest("hex").slice(0, 16);
}

function socketPathForUserData(userDataDir) {
  const socketPath = join(userDataDir, "pier-control.sock");
  if (Buffer.byteLength(socketPath) <= 103) {
    return socketPath;
  }
  return join(tmpdir(), `pier-control-${shortHash(userDataDir)}.sock`);
}

function resolveSocketPath() {
  if (process.env.PIER_CONTROL_SOCKET_PATH) {
    return process.env.PIER_CONTROL_SOCKET_PATH;
  }
  if (process.env.PIER_USER_DATA_DIR) {
    return socketPathForUserData(process.env.PIER_USER_DATA_DIR);
  }
  throw new Error("Set PIER_USER_DATA_DIR or PIER_CONTROL_SOCKET_PATH");
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function effectKey(_seed) {
  return b64urlEncode(randomBytes(24));
}

function pierCli(args) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin/pier.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(process.env.PIER_USER_DATA_DIR
        ? { PIER_USER_DATA_DIR: process.env.PIER_USER_DATA_DIR }
        : {}),
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    code: r.status ?? 1,
    out: `${r.stdout || ""}${r.stderr || ""}`,
  };
}

function parseLastJson(text) {
  const lines = String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* try previous */
    }
  }
  return null;
}

function record(results, name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function loadControlClient() {
  const url = pathToFileURL(join(ROOT, "bin/pier-control-client.js")).href;
  return import(url);
}

async function main() {
  const socketPath = resolveSocketPath();
  console.log(`socket=${socketPath}`);
  const results = [];
  const { invokePierControl } = await loadControlClient();

  {
    const { code, out } = pierCli(["status", "--json"]);
    const j = parseLastJson(out);
    record(results, "status", code === 0 && j?.ok === true, out.slice(0, 120));
  }
  {
    const { code, out } = pierCli(["snapshot", "--json"]);
    const j = parseLastJson(out);
    const hasRuntimes = j?.ok && j.data && Array.isArray(j.data.runtimes);
    record(
      results,
      "snapshot.has_runtimes_field",
      code === 0 && hasRuntimes,
      hasRuntimes ? `len=${j.data.runtimes.length}` : out.slice(0, 160)
    );
  }

  let runtime = null;
  try {
    const started = await invokePierControl({
      socketPath,
      op: "agents.start",
      params: { agentId: "codex", cwd: ROOT },
      clientKind: "cli-human",
      effectKey: effectKey("start"),
      timeoutMs: 60_000,
    });
    const ok =
      started.response?.ok === true &&
      started.response?.data?.runtime?.runtimeId;
    runtime = started.response?.data?.runtime ?? null;
    record(
      results,
      "cli_human.agents.start",
      Boolean(ok),
      ok
        ? `runtimeId=${runtime.runtimeId} gen=${runtime.generation}`
        : JSON.stringify(started.response).slice(0, 200)
    );
  } catch (err) {
    record(
      results,
      "cli_human.agents.start",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  if (runtime) {
    try {
      const turned = await invokePierControl({
        socketPath,
        op: "agents.turn",
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
          text: "w6-smoke-hello\n",
        },
        clientKind: "cli-human",
        effectKey: effectKey("turn"),
        timeoutMs: 30_000,
      });
      const ok =
        turned.response?.ok === true &&
        turned.response?.data?.accepted === true;
      record(
        results,
        "cli_human.agents.turn",
        ok,
        JSON.stringify(turned.response?.data ?? turned.response).slice(0, 160)
      );
    } catch (err) {
      record(
        results,
        "cli_human.agents.turn",
        false,
        err instanceof Error ? err.message : String(err)
      );
    }

    try {
      const screened = await invokePierControl({
        socketPath,
        op: "agents.screen",
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
          maxLines: 50,
          maxBytes: 8192,
        },
        clientKind: "cli-human",
        timeoutMs: 30_000,
      });
      const screen = screened.response?.data?.screen;
      const ok =
        screened.response?.ok === true &&
        screen &&
        typeof screen.text === "string" &&
        !("cursor" in screen) &&
        !("scrollback" in screen);
      record(
        results,
        "cli_human.agents.screen",
        ok,
        ok
          ? `rows=${screen.rows} truncated=${screen.truncated}`
          : JSON.stringify(screened.response).slice(0, 160)
      );
    } catch (err) {
      record(
        results,
        "cli_human.agents.screen",
        false,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  {
    const { code, out } = pierCli(["snapshot", "--json"]);
    const j = parseLastJson(out);
    const n = j?.data?.runtimes?.length ?? -1;
    record(
      results,
      "snapshot.runtimes_nonempty",
      code === 0 && n > 0,
      `runtimes=${n}`
    );
  }

  {
    const { out } = pierCli([
      "watch",
      "--after",
      "0",
      "--after-boot",
      "wrong-boot-id",
      "--timeout",
      "2000",
      "--json",
    ]);
    const j = parseLastJson(out);
    const ok =
      j?.ok === false &&
      (j?.error?.code === "snapshot_required" ||
        /boot_changed|snapshot_required/i.test(JSON.stringify(j)));
    record(
      results,
      "watch.wrong_boot_snapshot_required",
      ok,
      out.slice(0, 180)
    );
  }

  try {
    const inv = await invokePierControl({
      socketPath,
      op: "agents.invoke",
      params: {},
      clientKind: "cli-human",
      effectKey: effectKey("inv"),
      timeoutMs: 10_000,
    });
    const ok =
      inv.response?.ok === false &&
      (inv.response?.error?.code === "unsupported" ||
        /invoke/i.test(JSON.stringify(inv.response)));
    record(
      results,
      "agents.invoke_unsupported",
      ok,
      JSON.stringify(inv.response).slice(0, 160)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      results,
      "agents.invoke_unsupported",
      /unsupported|invoke/i.test(msg),
      msg.slice(0, 160)
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== SUMMARY pass=${results.length - failed.length} fail=${failed.length} total=${results.length} ===`
  );
  if (failed.length) {
    for (const f of failed) {
      console.log(`  FAIL ${f.name}: ${f.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
