import { postLinearGraphql } from "./linear-graphql.ts";

export async function listLinearProjects(input: {
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
  teamKey: string;
}): Promise<Array<{ key: string; name: string }>> {
  const data = await postLinearGraphql<{
    projects?: {
      nodes?: Array<{
        id?: string;
        name?: string;
        teams?: { nodes?: Array<{ key?: string }> };
      }>;
    };
  }>({
    fetchImpl: input.fetchImpl ?? fetch,
    getToken: input.getToken,
    query: `query {
      projects(first: 50) {
        nodes {
          id
          name
          teams(first: 20) { nodes { key } }
        }
      }
    }`,
  });
  const team = input.teamKey.toLowerCase();
  return (data.projects?.nodes ?? [])
    .filter((project) => {
      if (!(project.id && project.name)) {
        return false;
      }
      const keys = project.teams?.nodes ?? [];
      return (
        keys.length === 0 ||
        keys.some((item) => item.key?.toLowerCase() === team)
      );
    })
    .map((project) => ({
      key: project.id as string,
      name: project.name as string,
    }));
}

export async function listLinearTeams(input: {
  fetchImpl?: typeof fetch;
  getToken: () => Promise<string | null>;
}): Promise<Array<{ key: string; name: string }>> {
  const data = await postLinearGraphql<{
    teams?: { nodes?: Array<{ key?: string; name?: string }> };
  }>({
    fetchImpl: input.fetchImpl ?? fetch,
    getToken: input.getToken,
    query: `query {
      teams(first: 50) { nodes { key name } }
    }`,
  });
  return (data.teams?.nodes ?? [])
    .filter((team): team is { key: string; name: string } =>
      Boolean(team.key && team.name)
    )
    .map((team) => ({ key: team.key, name: team.name }));
}
