import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MainPluginContext } from "@pier/plugin-api/main";
import {
  GITHUB_TOKEN_SECRET,
  JIRA_BASE_URL_SECRET,
  JIRA_TOKEN_SECRET,
  LINEAR_TOKEN_SECRET,
} from "../shared/constants.ts";
import type { CredentialStatus } from "../shared/types.ts";

const execFileAsync = promisify(execFile);

export interface GithubCredentials {
  delete(): Promise<void>;
  deleteProvider(provider: "github" | "jira" | "linear"): Promise<void>;
  getJiraBaseUrl(): Promise<string | null>;
  getProviderToken(
    provider: "github" | "jira" | "linear"
  ): Promise<string | null>;
  getToken(): Promise<string | null>;
  probeGhToken(): Promise<string | null>;
  setJiraBaseUrl(value: string): Promise<void>;
  setProviderToken(
    provider: "github" | "jira" | "linear",
    token: string
  ): Promise<void>;
  setToken(token: string): Promise<void>;
  status(): Promise<CredentialStatus>;
}

async function fetchLogin(
  token: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const response = await fetchImpl("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "pier.tasks",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    return null;
  }
  const body: unknown = await response.json();
  if (
    body &&
    typeof body === "object" &&
    "login" in body &&
    typeof body.login === "string"
  ) {
    return body.login;
  }
  return null;
}

function secretKey(provider: "github" | "jira" | "linear"): string {
  if (provider === "linear") {
    return LINEAR_TOKEN_SECRET;
  }
  if (provider === "jira") {
    return JIRA_TOKEN_SECRET;
  }
  return GITHUB_TOKEN_SECRET;
}

export function createGithubCredentials(input: {
  fetchImpl?: typeof fetch;
  logger: MainPluginContext["logger"];
  probe?: () => Promise<string | null>;
  processEnv: Readonly<Record<string, string | undefined>>;
  secrets: MainPluginContext["secrets"];
}): GithubCredentials {
  const fetchImpl = input.fetchImpl ?? fetch;
  const probe =
    input.probe ??
    (async () => {
      try {
        const result = await execFileAsync("gh", ["auth", "token"], {
          env: { ...input.processEnv },
          timeout: 8000,
        });
        const token = result.stdout.trim();
        return token.length > 0 ? token : null;
      } catch (error: unknown) {
        input.logger.debug("[pier.tasks] gh auth token probe failed", error);
        return null;
      }
    });

  return {
    delete: () => input.secrets.delete(GITHUB_TOKEN_SECRET),
    deleteProvider: (provider) => input.secrets.delete(secretKey(provider)),
    getJiraBaseUrl: () => input.secrets.get(JIRA_BASE_URL_SECRET),
    getProviderToken: (provider) => input.secrets.get(secretKey(provider)),
    getToken: () => input.secrets.get(GITHUB_TOKEN_SECRET),
    probeGhToken: probe,
    setJiraBaseUrl: (value) => input.secrets.set(JIRA_BASE_URL_SECRET, value),
    setProviderToken: (provider, token) =>
      input.secrets.set(secretKey(provider), token),
    setToken: (token) => input.secrets.set(GITHUB_TOKEN_SECRET, token),
    async status() {
      const [stored, linear, jira, jiraBaseUrl] = await Promise.all([
        input.secrets.get(GITHUB_TOKEN_SECRET),
        input.secrets.get(LINEAR_TOKEN_SECRET),
        input.secrets.get(JIRA_TOKEN_SECRET),
        input.secrets.get(JIRA_BASE_URL_SECRET),
      ]);
      if (stored) {
        const login = await fetchLogin(stored, fetchImpl);
        return {
          authorized: true,
          jiraAuthorized: Boolean(jira),
          jiraBaseUrl,
          linearAuthorized: Boolean(linear),
          login,
          probed: false,
        };
      }
      const probed = await probe();
      return {
        authorized: false,
        jiraAuthorized: Boolean(jira),
        jiraBaseUrl,
        linearAuthorized: Boolean(linear),
        login: null,
        probed: probed !== null,
      };
    },
  };
}
