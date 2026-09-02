const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

function isLinearAuthFailure(status: number, message: string): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  return /unauth|not authorized|authentication required/i.test(message);
}

function linearGraphqlMessage(body: unknown): string | null {
  if (!(body && typeof body === "object" && "errors" in body)) {
    return null;
  }
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  const first = errors[0];
  if (first && typeof first === "object" && "message" in first) {
    const message = (first as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Linear GraphQL error";
}

export function parseLinearGraphqlBody(body: unknown, status: number): unknown {
  const message = linearGraphqlMessage(body);
  if (isLinearAuthFailure(status, message ?? "")) {
    throw new Error("Linear is not authorized");
  }
  if (message) {
    throw new Error(message);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Linear HTTP ${status}`);
  }
  if (!(body && typeof body === "object" && "data" in body)) {
    throw new Error("Linear returned no data");
  }
  const data = (body as { data: unknown }).data;
  if (data == null) {
    throw new Error("Linear returned no data");
  }
  return data;
}

export async function postLinearGraphql<T>(input: {
  fetchImpl: typeof fetch;
  getToken: () => Promise<string | null>;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const token = await input.getToken();
  if (!token) {
    throw new Error("Linear is not authorized");
  }
  const response = await input.fetchImpl(LINEAR_GRAPHQL, {
    body: JSON.stringify({
      query: input.query,
      variables: input.variables ?? {},
    }),
    headers: {
      Authorization: token.trim(),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body: unknown = await response.json();
  return parseLinearGraphqlBody(body, response.status) as T;
}
