import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexProvider,
  PIER_MANAGED_HOME_MARKER,
} from "@main/services/agent-accounts/codex-provider.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `pier-codex-provider-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** 构造伪 JWT（不校验签名，只用于 syncBack 身份校验测试）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true }))
  );
});

describe("createCodexProvider", () => {
  it("materialize 把托管 auth.json 写入 realCodexHome", async () => {
    const managedDir = await makeTempDir("managed");
    const realHome = await makeTempDir("real");
    const authContent = JSON.stringify({ tokens: { id_token: "fake" } });
    await writeFile(join(managedDir, "auth.json"), authContent);

    const provider = createCodexProvider({
      realCodexHome: realHome,
    });
    await provider.materialize(managedDir);

    const written = await readFile(join(realHome, "auth.json"), "utf-8");
    expect(written).toBe(authContent);
  });

  it("materialize 在 realCodexHome 不存在时自建目录（新机首次切号）", async () => {
    const managedDir = await makeTempDir("managed-fresh");
    // realHome 指向一个尚不存在的子路径（模拟从未跑过 codex 的机器）
    const realHome = join(await makeTempDir("real-fresh"), ".codex");
    const authContent = JSON.stringify({ tokens: { id_token: "fresh" } });
    await writeFile(join(managedDir, "auth.json"), authContent);

    const provider = createCodexProvider({ realCodexHome: realHome });
    // 修复前此处 ENOENT
    await provider.materialize(managedDir);

    const written = await readFile(join(realHome, "auth.json"), "utf-8");
    expect(written).toBe(authContent);
  });

  it("syncBack 身份匹配时回采 auth.json 并返回 ok", async () => {
    const managedDir = await makeTempDir("managed-sb");
    const realHome = await makeTempDir("real-sb");
    const jwt = fakeJwt({
      email: "a@b.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "prov-acc-1" },
    });
    const authContent = JSON.stringify({ tokens: { id_token: jwt } });
    await writeFile(join(realHome, "auth.json"), authContent);

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, "prov-acc-1");

    expect(result).toBe("ok");
    const synced = await readFile(join(managedDir, "auth.json"), "utf-8");
    expect(synced).toBe(authContent);
  });

  it("syncBack 身份不匹配时返回 identity-mismatch 且不复制", async () => {
    const managedDir = await makeTempDir("managed-mm");
    const realHome = await makeTempDir("real-mm");
    const jwt = fakeJwt({
      email: "a@b.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "prov-acc-OTHER" },
    });
    await writeFile(
      join(realHome, "auth.json"),
      JSON.stringify({ tokens: { id_token: jwt } })
    );

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, "prov-acc-1");

    expect(result).toBe("identity-mismatch");
    // 不应复制文件到托管目录
    await expect(
      readFile(join(managedDir, "auth.json"), "utf-8")
    ).rejects.toThrow();
  });

  it("syncBack expectedProviderAccountId 为 undefined 时跳过身份校验", async () => {
    const managedDir = await makeTempDir("managed-undef");
    const realHome = await makeTempDir("real-undef");
    const authContent = JSON.stringify({
      tokens: { id_token: "refreshed" },
      last_refresh: 999,
    });
    await writeFile(join(realHome, "auth.json"), authContent);

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, undefined);

    expect(result).toBe("ok");
    const synced = await readFile(join(managedDir, "auth.json"), "utf-8");
    expect(synced).toBe(authContent);
  });

  it("login spawn 用传入的 spawn 替身", async () => {
    const managedDir = await makeTempDir("login");
    const realHome = await makeTempDir("real-login");
    const spawnCalls: Array<{
      cmd: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];

    const provider = createCodexProvider({
      realCodexHome: realHome,
      spawnLogin: (cmd, args, opts) => {
        spawnCalls.push({
          cmd,
          args,
          env: opts.env as Record<string, string | undefined>,
        });
        // 模拟成功退出
        return Promise.resolve();
      },
    });

    const ac = new AbortController();
    await provider.login(managedDir, ac.signal);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toContain("login");
    expect(spawnCalls[0]?.env.CODEX_HOME).toBe(managedDir);
  });

  it("watchExternalAuth watch 父目录并按 auth.json 文件名过滤", async () => {
    const realHome = await makeTempDir("real-watch");
    const provider = createCodexProvider({ realCodexHome: realHome });
    const cb = vi.fn();
    const dispose = provider.watchExternalAuth(cb);
    expect(typeof dispose).toBe("function");
    dispose();
  });

  it("PIER_MANAGED_HOME_MARKER 常量为 .pier-managed-home", () => {
    expect(PIER_MANAGED_HOME_MARKER).toBe(".pier-managed-home");
  });
});
