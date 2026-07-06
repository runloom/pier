import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseIdTokenClaims,
  readCodexIdentity,
} from "@main/services/agent-accounts/identity.ts";
import { afterEach, describe, expect, it } from "vitest";

/** 构造伪 JWT：header.payload.signature（signature 不校验，只用于解析 payload）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

describe("parseIdTokenClaims", () => {
  it("从合法 JWT 提取 email / planType / providerAccountId", () => {
    const token = fakeJwt({
      email: "alice@openai.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "pro",
        chatgpt_account_id: "acc-xyz-123",
      },
    });
    const claims = parseIdTokenClaims(token);
    expect(claims).toEqual({
      email: "alice@openai.com",
      planType: "pro",
      providerAccountId: "acc-xyz-123",
    });
  });

  it("email 缺失时返回 null", () => {
    const token = fakeJwt({
      "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
    });
    expect(parseIdTokenClaims(token)).toBeNull();
  });

  it("无 auth 命名空间时 planType/providerAccountId 为 undefined", () => {
    const token = fakeJwt({ email: "bob@example.com" });
    const claims = parseIdTokenClaims(token);
    expect(claims).toEqual({
      email: "bob@example.com",
      planType: undefined,
      providerAccountId: undefined,
    });
  });

  it("非三段 token 返回 null", () => {
    expect(parseIdTokenClaims("not-a-jwt")).toBeNull();
  });

  it("payload 非 JSON 返回 null", () => {
    expect(parseIdTokenClaims("a.!!!invalid-base64.c")).toBeNull();
  });
});

describe("readCodexIdentity", () => {
  const tempDirs: string[] = [];

  async function makeTempHome(): Promise<string> {
    const dir = join(
      tmpdir(),
      `pier-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("读取合法 auth.json 返回身份", async () => {
    const home = await makeTempHome();
    const authJson = {
      tokens: {
        id_token: fakeJwt({
          email: "charlie@openai.com",
          "https://api.openai.com/auth": {
            chatgpt_plan_type: "plus",
            chatgpt_account_id: "acc-charlie",
          },
        }),
      },
    };
    await writeFile(join(home, "auth.json"), JSON.stringify(authJson));
    const identity = await readCodexIdentity(home);
    expect(identity).toEqual({
      email: "charlie@openai.com",
      planType: "plus",
      providerAccountId: "acc-charlie",
    });
  });

  it("auth.json 不存在返回 null", async () => {
    const home = await makeTempHome();
    expect(await readCodexIdentity(home)).toBeNull();
  });

  it("auth.json 无 tokens.id_token 返回 null", async () => {
    const home = await makeTempHome();
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({ auth_mode: "oauth" })
    );
    expect(await readCodexIdentity(home)).toBeNull();
  });

  it("auth.json 损坏（非 JSON）返回 null", async () => {
    const home = await makeTempHome();
    await writeFile(join(home, "auth.json"), "not json {{");
    expect(await readCodexIdentity(home)).toBeNull();
  });
});
