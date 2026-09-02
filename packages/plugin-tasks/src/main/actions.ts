import { columnIsReadonly, type TaskColumnId } from "../shared/columns.ts";
import type { TaskBoardParams, TaskBoardSnapshot } from "../shared/types.ts";
import type { TrackerProvider } from "./providers/types.ts";
import type { createKeyedMutationLanes } from "./serial-queue.ts";

export function createTaskActions(input: {
  laneFor: ReturnType<typeof createKeyedMutationLanes>;
  provider: TrackerProvider;
  /** Cache-first read. Must not emit a new generation (that races optimistic UI). */
  read?: (params: TaskBoardParams) => Promise<TaskBoardSnapshot>;
  refresh: (params: TaskBoardParams) => Promise<TaskBoardSnapshot>;
}): {
  assign(input: {
    itemKey: string;
    login: string | null;
    params: TaskBoardParams;
  }): Promise<TaskBoardSnapshot>;
  close(input: {
    confirm?: boolean | undefined;
    itemKey: string;
    params: TaskBoardParams;
  }): Promise<TaskBoardSnapshot>;
  create(input: {
    body?: string | undefined;
    params: TaskBoardParams;
    title: string;
  }): Promise<TaskBoardSnapshot>;
  setStatus(input: {
    columnId: TaskColumnId;
    confirm?: boolean | undefined;
    itemKey: string;
    params: TaskBoardParams;
    rankAfterKey?: string | undefined;
    rankBeforeKey?: string | undefined;
    sortOrder?: number | undefined;
  }): Promise<TaskBoardSnapshot>;
} {
  return {
    assign({ itemKey, login, params }) {
      return input.laneFor(itemKey)(async () => {
        await input.provider.setAssignees(
          itemKey,
          login ? [login] : [],
          params
        );
        return await input.refresh(params);
      });
    },
    close({ confirm, itemKey, params }) {
      return input.laneFor(itemKey)(async () => {
        if (!confirm) {
          throw new Error("closing a task requires explicit confirmation");
        }
        await input.provider.setClosed(itemKey, true, params);
        return await input.refresh(params);
      });
    },
    create({ body, params, title }) {
      return input.laneFor(`create:${params.repo}`)(async () => {
        await input.provider.createIssue(params, {
          ...(body ? { body } : {}),
          title,
        });
        return await input.refresh(params);
      });
    },
    setStatus({
      columnId,
      confirm,
      itemKey,
      params,
      rankAfterKey,
      rankBeforeKey,
      sortOrder,
    }) {
      return input.laneFor(itemKey)(async () => {
        const snapshot = await (input.read ?? input.refresh)(params);
        const card = snapshot.columns
          .flatMap((column) => column.items)
          .find((item) => item.key === itemKey);
        const writeColumn = input.provider.setColumnStatus;
        if (
          writeColumn &&
          (params.provider === "linear" || params.provider === "jira")
        ) {
          const options =
            sortOrder === undefined && !rankAfterKey && !rankBeforeKey
              ? undefined
              : {
                  ...(rankAfterKey ? { rankAfterKey } : {}),
                  ...(rankBeforeKey ? { rankBeforeKey } : {}),
                  ...(sortOrder === undefined ? {} : { sortOrder }),
                };
          await writeColumn(itemKey, columnId, params, options);
          return await input.refresh(params);
        }
        if (
          columnIsReadonly(columnId, {
            ...(confirm === undefined ? {} : { confirm }),
            ...(card ? { linkedPRs: card.linkedPRs } : {}),
          })
        ) {
          throw new Error("done column is read-only");
        }
        if (columnId === "done") {
          await input.provider.setClosed(itemKey, true, params);
          return await input.refresh(params);
        }
        const login = await input.provider.viewerLogin(params);
        if (columnId === "inProgress") {
          if (!login) {
            throw new Error("not authorized");
          }
          await input.provider.setAssignees(itemKey, [login], params);
          // A closed card dragged back to In Progress must reopen, or the
          // heuristic snaps it straight back into Done on the next poll.
          await input.provider
            .setClosed(itemKey, false, params)
            .catch(() => undefined);
        } else {
          await input.provider.setAssignees(itemKey, [], params);
          await input.provider
            .setClosed(itemKey, false, params)
            .catch(() => undefined);
        }
        return await input.refresh(params);
      });
    },
  };
}
