import { describe, expect, it } from "vitest";
import { createJiraProvider } from "../../../../packages/plugin-tasks/src/main/providers/jira.ts";

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function providerFor(
  fetchImpl: typeof fetch
): ReturnType<typeof createJiraProvider> {
  return createJiraProvider({
    baseUrl: async () => "https://example.atlassian.net",
    fetchImpl,
    getToken: async () => "jira-token",
  });
}

describe("Jira tracker provider", () => {
  it("loads issues ordered by Rank and falls back without it", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      if (String(url).includes("ORDER%20BY%20Rank")) {
        return jsonResponse(400, {
          errorMessages: ["Field 'Rank' does not exist"],
        });
      }
      return jsonResponse(200, {
        issues: [
          {
            fields: {
              status: { statusCategory: { key: "new" } },
              summary: "Ship",
            },
            key: "ENG-1",
          },
        ],
      });
    }) as typeof fetch;
    const board = await providerFor(fetchImpl).fetchBoard({
      provider: "jira",
      repo: "ENG",
    });
    expect(urls.some((url) => /ORDER%20BY%20Rank/.test(url))).toBe(true);
    expect(
      urls.some((url) =>
        url.includes("fields=summary,status,assignee,issuelinks")
      )
    ).toBe(true);
    expect(board.columns[0]?.items.map((item) => item.key)).toEqual(["ENG-1"]);
    expect(board.capabilities?.persistRank).toBe(false);
  });

  it("keeps Jira project statuses as separate columns", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/project/") && href.endsWith("/statuses")) {
        return jsonResponse(200, [
          {
            statuses: [
              {
                id: "1",
                name: "待办",
                statusCategory: { key: "new" },
              },
              {
                id: "2",
                name: "验证中",
                statusCategory: { key: "indeterminate" },
              },
              {
                id: "3",
                name: "已完成",
                statusCategory: { key: "done" },
              },
            ],
          },
        ]);
      }
      return jsonResponse(200, {
        issues: [
          {
            fields: {
              status: {
                id: "2",
                name: "验证中",
                statusCategory: { key: "indeterminate" },
              },
              summary: "Review",
            },
            key: "ENG-9",
          },
        ],
      });
    }) as typeof fetch;
    const board = await providerFor(fetchImpl).fetchBoard({
      provider: "jira",
      repo: "ENG",
    });
    expect(board.columns.map((column) => column.title)).toEqual([
      "待办",
      "验证中",
      "已完成",
    ]);
    expect(board.columns[1]?.items.map((item) => item.key)).toEqual(["ENG-9"]);
  });

  it("transitions then ranks so the drop index survives a column change", async () => {
    const calls: Array<{ body?: string; url: string }> = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      const href = String(url);
      calls.push({ body: String(init?.body ?? ""), url: href });
      if (href.includes("fields=status") && !href.includes("transitions")) {
        return jsonResponse(200, {
          fields: {
            status: { id: "1", statusCategory: { key: "new" } },
          },
        });
      }
      if (href.endsWith("/transitions") && init?.method === undefined) {
        return jsonResponse(200, {
          transitions: [
            {
              id: "21",
              to: {
                id: "21-status",
                statusCategory: { key: "indeterminate" },
              },
            },
          ],
        });
      }
      return jsonResponse(204, {});
    }) as typeof fetch;
    await providerFor(fetchImpl).setColumnStatus?.(
      "ENG-1",
      "21-status",
      { provider: "jira", repo: "ENG" },
      { rankBeforeKey: "ENG-9", sortOrder: 150 }
    );
    const transition = calls.find(
      (item) =>
        item.url.endsWith("/transitions") && (item.body ?? "").includes("21")
    );
    const rank = calls.find((item) =>
      item.url.includes("/rest/agile/1.0/issue/rank")
    );
    expect(transition).toBeDefined();
    expect(JSON.parse(rank?.body ?? "{}")).toEqual({
      issues: ["ENG-1"],
      rankBeforeIssue: "ENG-9",
    });
  });

  it("ranks in-column without posting a same-category transition", async () => {
    const methods: string[] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      const href = String(url);
      methods.push(`${init?.method ?? "GET"} ${href}`);
      if (href.includes("fields=status")) {
        return jsonResponse(200, {
          fields: { status: { statusCategory: { key: "indeterminate" } } },
        });
      }
      return jsonResponse(204, {});
    }) as typeof fetch;
    await providerFor(fetchImpl).setColumnStatus?.(
      "ENG-1",
      "inProgress",
      { provider: "jira", repo: "ENG" },
      { rankAfterKey: "ENG-2" }
    );
    expect(methods.some((item) => item.includes("/transitions"))).toBe(false);
    const rank = methods.find((item) => item.includes("/issue/rank"));
    expect(rank).toMatch(/^PUT /);
  });

  it("throws when a column transition is rejected", async () => {
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      const href = String(url);
      if (href.includes("fields=status") && !href.includes("transitions")) {
        return jsonResponse(200, {
          fields: { status: { id: "1", statusCategory: { key: "new" } } },
        });
      }
      if (href.endsWith("/transitions") && init?.method === undefined) {
        return jsonResponse(200, {
          transitions: [
            {
              id: "21",
              to: { id: "21-status", statusCategory: { key: "indeterminate" } },
            },
          ],
        });
      }
      if (href.endsWith("/transitions") && init?.method === "POST") {
        return jsonResponse(400, { errorMessages: ["not allowed"] });
      }
      return jsonResponse(204, {});
    }) as typeof fetch;
    await expect(
      providerFor(fetchImpl).setColumnStatus?.("ENG-1", "21-status", {
        provider: "jira",
        repo: "ENG",
      })
    ).rejects.toThrow(/Jira HTTP 400/);
  });

  it("throws when Agile Rank is rejected", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("fields=status")) {
        return jsonResponse(200, {
          fields: {
            status: { id: "2", statusCategory: { key: "indeterminate" } },
          },
        });
      }
      if (href.includes("/issue/rank")) {
        return jsonResponse(400, { errorMessages: ["Rank is disabled"] });
      }
      return jsonResponse(204, {});
    }) as typeof fetch;
    await expect(
      providerFor(fetchImpl).setColumnStatus?.(
        "ENG-1",
        "inProgress",
        { provider: "jira", repo: "ENG" },
        { rankAfterKey: "ENG-2" }
      )
    ).rejects.toThrow(/Jira HTTP 400/);
  });
});
