import { describe, expect, it } from "vitest";
import { createLinearProvider } from "../../../../packages/plugin-tasks/src/main/providers/linear.ts";
import { listLinearTeams } from "../../../../packages/plugin-tasks/src/main/providers/linear-catalog.ts";
import { parseLinearGraphqlBody } from "../../../../packages/plugin-tasks/src/main/providers/linear-graphql.ts";

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

describe("Linear GraphQL client", () => {
  it("throws the GraphQL error instead of reading null data", () => {
    expect(() =>
      parseLinearGraphqlBody(
        {
          data: null,
          errors: [
            {
              message:
                "You must provide a `first` or `last` value to properly paginate the `blockingIssues` connection.",
            },
          ],
        },
        200
      )
    ).toThrow(/first/);
  });

  it("maps HTTP 401 and GraphQL auth errors to not authorized", () => {
    expect(() => parseLinearGraphqlBody({}, 401)).toThrow(
      "Linear is not authorized"
    );
    expect(() =>
      parseLinearGraphqlBody(
        { errors: [{ message: "Authentication required, not authenticated" }] },
        200
      )
    ).toThrow("Linear is not authorized");
  });

  it("reads blockers from inverseRelations, not blockingIssues", async () => {
    const queries: string[] = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
      };
      queries.push(payload.query ?? "");
      return jsonResponse(200, {
        data: {
          issues: {
            nodes: [
              {
                assignee: { name: "Ada" },
                identifier: "ENG-12",
                inverseRelations: {
                  nodes: [
                    {
                      issue: {
                        completedAt: null,
                        identifier: "ENG-3",
                        state: { type: "started" },
                        title: "Auth",
                        url: "https://linear.app/acme/issue/ENG-3",
                      },
                      type: "blocks",
                    },
                    {
                      issue: {
                        completedAt: "2026-01-01T00:00:00.000Z",
                        identifier: "ENG-1",
                        state: { type: "completed" },
                        title: "Done blocker",
                        url: "https://linear.app/acme/issue/ENG-1",
                      },
                      type: "blocks",
                    },
                  ],
                },
                relations: { nodes: [] },
                state: { type: "unstarted" },
                title: "Ship",
                url: "https://linear.app/acme/issue/ENG-12",
              },
            ],
          },
        },
      });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    const board = await provider.fetchBoard({
      provider: "linear",
      repo: "ENG",
    });
    expect(queries[0]).not.toMatch(/blockingIssues/);
    expect(queries[0]).toMatch(/inverseRelations\(first:\s*20\)/);
    expect(queries[0]).toMatch(/relations\(first:\s*20\)/);
    const card = board.columns[0]?.items[0];
    expect(card?.key).toBe("ENG-12");
    expect(card?.blockers).toEqual([
      expect.objectContaining({ key: "ENG-3", title: "Auth" }),
    ]);
    expect(card?.openBlockedByCount).toBe(1);
  });

  it("filters issues by Linear project when projectId is set", async () => {
    const variables: unknown[] = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        variables?: unknown;
      };
      variables.push(payload.variables);
      expect(payload.query).toMatch(/\$projectId:\s*ID!/);
      expect(payload.query).toMatch(
        /project:\s*\{\s*id:\s*\{\s*eq:\s*\$projectId/
      );
      return jsonResponse(200, { data: { issues: { nodes: [] } } });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    await provider.fetchBoard({
      projectId: "proj-1",
      provider: "linear",
      repo: "ENG",
    });
    expect(variables[0]).toEqual({ projectId: "proj-1", team: "ENG" });
  });

  it("keeps Linear workflow states as separate columns instead of three buckets", async () => {
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const query = String(
        (JSON.parse(String(init?.body ?? "{}")) as { query?: string }).query ??
          ""
      );
      if (query.includes("states(first: 50)")) {
        return jsonResponse(200, {
          data: {
            teams: {
              nodes: [
                {
                  states: {
                    nodes: [
                      {
                        id: "state-todo",
                        name: "任务",
                        position: 0,
                        type: "unstarted",
                      },
                      {
                        id: "state-verify",
                        name: "验证中",
                        position: 1,
                        type: "started",
                      },
                      {
                        id: "state-done",
                        name: "已完成",
                        position: 2,
                        type: "completed",
                      },
                      {
                        id: "state-cancel",
                        name: "已取消",
                        position: 3,
                        type: "canceled",
                      },
                    ],
                  },
                },
              ],
            },
          },
        });
      }
      return jsonResponse(200, {
        data: {
          issues: {
            nodes: [
              {
                identifier: "FL-1",
                sortOrder: 1,
                state: { id: "state-todo", name: "任务", type: "unstarted" },
                title: "Todo card",
                url: "https://linear.app/fl-1",
              },
              {
                identifier: "FL-2",
                sortOrder: 1,
                state: {
                  id: "state-verify",
                  name: "验证中",
                  type: "started",
                },
                title: "Verify card",
                url: "https://linear.app/fl-2",
              },
              {
                identifier: "FL-3",
                sortOrder: 1,
                state: { id: "state-done", name: "已完成", type: "completed" },
                title: "Done card",
                url: "https://linear.app/fl-3",
              },
              {
                identifier: "FL-4",
                sortOrder: 1,
                state: {
                  id: "state-cancel",
                  name: "已取消",
                  type: "canceled",
                },
                title: "Canceled card",
                url: "https://linear.app/fl-4",
              },
            ],
          },
        },
      });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    const board = await provider.fetchBoard({
      provider: "linear",
      repo: "FL",
    });
    expect(board.columns.map((column) => column.title)).toEqual([
      "任务",
      "验证中",
      "已完成",
      "已取消",
    ]);
    expect(board.columns.map((column) => column.items[0]?.key)).toEqual([
      "FL-1",
      "FL-2",
      "FL-3",
      "FL-4",
    ]);
    expect(board.columns.map((column) => column.kind)).toEqual([
      "todo",
      "inProgress",
      "done",
      "canceled",
    ]);
  });

  it("writes the dropped Linear state id, not the first state of that type", async () => {
    const payloads: Array<{ query?: string; variables?: unknown }> = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        variables?: unknown;
      };
      payloads.push(payload);
      const query = payload.query ?? "";
      if (query.includes("$number")) {
        return jsonResponse(200, {
          data: { issues: { nodes: [{ id: "issue-1" }] } },
        });
      }
      if (query.includes("states")) {
        return jsonResponse(200, {
          data: {
            issue: {
              state: { id: "state-todo", type: "unstarted" },
              team: {
                states: {
                  nodes: [
                    { id: "state-todo", type: "unstarted" },
                    { id: "state-verify", type: "started" },
                    { id: "state-progress", type: "started" },
                  ],
                },
              },
            },
          },
        });
      }
      return jsonResponse(200, { data: { issueUpdate: { success: true } } });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    await provider.setColumnStatus?.(
      "FL-1",
      "state-verify",
      { provider: "linear", repo: "FL" },
      { sortOrder: 12 }
    );
    const updates = payloads
      .filter((item) => (item.query ?? "").includes("issueUpdate"))
      .map((item) => item.variables);
    expect(updates).toEqual([
      { id: "issue-1", input: { stateId: "state-verify" } },
      { id: "issue-1", input: { sortOrder: 12 } },
    ]);
  });

  it("orders Linear cards by sortOrder within a column", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        data: {
          issues: {
            nodes: [
              {
                identifier: "ENG-2",
                sortOrder: 20,
                state: { type: "unstarted" },
                title: "Second",
                url: "https://linear.app/eng-2",
              },
              {
                identifier: "ENG-1",
                sortOrder: 10,
                state: { type: "unstarted" },
                title: "First",
                url: "https://linear.app/eng-1",
              },
            ],
          },
        },
      })) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    const board = await provider.fetchBoard({
      provider: "linear",
      repo: "ENG",
    });
    expect(board.columns[0]?.items.map((item) => item.key)).toEqual([
      "ENG-1",
      "ENG-2",
    ]);
  });

  it("writes Linear rank after the state change so team auto-rank cannot clobber it", async () => {
    const payloads: Array<{ query?: string; variables?: unknown }> = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        variables?: unknown;
      };
      payloads.push(payload);
      const query = payload.query ?? "";
      if (query.includes("$number")) {
        return jsonResponse(200, {
          data: { issues: { nodes: [{ id: "issue-1" }] } },
        });
      }
      if (query.includes("states")) {
        return jsonResponse(200, {
          data: {
            issue: {
              state: { type: "unstarted" },
              team: {
                states: { nodes: [{ id: "state-started", type: "started" }] },
              },
            },
          },
        });
      }
      return jsonResponse(200, {
        data: { issueUpdate: { success: true } },
      });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    await provider.setColumnStatus?.(
      "ENG-1",
      "inProgress",
      { provider: "linear", repo: "ENG" },
      { sortOrder: 150 }
    );
    const updates = payloads
      .filter((item) => (item.query ?? "").includes("issueUpdate"))
      .map((item) => item.variables);
    expect(updates).toEqual([
      { id: "issue-1", input: { stateId: "state-started" } },
      { id: "issue-1", input: { sortOrder: 150 } },
    ]);
  });

  it("writes only sortOrder when the issue is already in that workflow type", async () => {
    const payloads: Array<{ query?: string; variables?: unknown }> = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        variables?: unknown;
      };
      payloads.push(payload);
      const query = payload.query ?? "";
      if (query.includes("$number")) {
        return jsonResponse(200, {
          data: { issues: { nodes: [{ id: "issue-1" }] } },
        });
      }
      if (query.includes("states")) {
        return jsonResponse(200, {
          data: {
            issue: {
              state: { id: "state-started", type: "started" },
              team: {
                states: { nodes: [{ id: "state-started", type: "started" }] },
              },
            },
          },
        });
      }
      return jsonResponse(200, {
        data: { issueUpdate: { success: true } },
      });
    }) as typeof fetch;
    const provider = createLinearProvider({
      fetchImpl,
      getToken: async () => "lin_api_test",
    });
    await provider.setColumnStatus?.(
      "ENG-1",
      "inProgress",
      { provider: "linear", repo: "ENG" },
      { sortOrder: 80 }
    );
    const updates = payloads
      .filter((item) => (item.query ?? "").includes("issueUpdate"))
      .map((item) => item.variables);
    expect(updates).toEqual([{ id: "issue-1", input: { sortOrder: 80 } }]);
  });

  it("lists teams through the same GraphQL error path", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        data: { teams: { nodes: [{ key: "ENG", name: "Engineering" }] } },
      })) as typeof fetch;
    await expect(
      listLinearTeams({ fetchImpl, getToken: async () => "lin_api_test" })
    ).resolves.toEqual([{ key: "ENG", name: "Engineering" }]);
  });
});
