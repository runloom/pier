import { describe, expect, it } from "vitest";
import { createGithubCredentials } from "../../../../packages/plugin-tasks/src/main/credentials.ts";
import {
  JIRA_API_TOKENS_URL,
  LINEAR_PERSONAL_API_KEYS_URL,
  LINEAR_TOKEN_SECRET,
} from "../../../../packages/plugin-tasks/src/shared/constants.ts";

function logger() {
  return {
    debug() {},
    error() {},
    info() {},
    warn() {},
  };
}

function memorySecrets(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    delete: async (key: string) => {
      store.delete(key);
    },
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("task tracker credentials", () => {
  it("points Linear and Jira bind flows at the provider create-key pages", () => {
    expect(LINEAR_PERSONAL_API_KEYS_URL).toBe(
      "https://linear.app/settings/account/security"
    );
    expect(JIRA_API_TOKENS_URL).toBe(
      "https://id.atlassian.com/manage-profile/security/api-tokens"
    );
  });

  it("probes LINEAR_API_KEY without treating it as already authorized", async () => {
    const credentials = createGithubCredentials({
      logger: logger(),
      probe: async () => null,
      processEnv: { LINEAR_API_KEY: "  lin_api_env  " },
      secrets: memorySecrets(),
    });
    const status = await credentials.status();
    expect(status.linearProbed).toBe(true);
    expect(status.linearAuthorized).toBe(false);
    expect(await credentials.probeLinearToken()).toBe("lin_api_env");
  });

  it("ignores a blank LINEAR_API_KEY", async () => {
    const credentials = createGithubCredentials({
      logger: logger(),
      probe: async () => null,
      processEnv: { LINEAR_API_KEY: "   " },
      secrets: memorySecrets(),
    });
    const status = await credentials.status();
    expect(status.linearProbed).toBe(false);
    expect(await credentials.probeLinearToken()).toBeNull();
  });

  it("reports stored Linear keys as authorized independently of env probe", async () => {
    const credentials = createGithubCredentials({
      logger: logger(),
      probe: async () => null,
      processEnv: {},
      secrets: memorySecrets({ [LINEAR_TOKEN_SECRET]: "lin_api_saved" }),
    });
    const status = await credentials.status();
    expect(status.linearAuthorized).toBe(true);
    expect(status.linearProbed).toBe(false);
  });
});
