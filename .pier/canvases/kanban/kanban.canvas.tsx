import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Droppable,
  Row,
  Sortable,
  Stack,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useCallback, useEffect, useRef, useState } from "react";

export const canvas = {
  description:
    "Full-bleed kanban: fill stack, Droppable columns, Sortable cards, sibling watch.",
  kind: "composition" as const,
  title: "Kanban",
};

type Column = { id: string; title: string };
type Card = {
  assignee?: string | undefined;
  column: string;
  id: string;
  priority?: string | undefined;
  tag?: string | undefined;
  title: string;
};
type Board = { cards: Card[]; columns: Column[] };

const FALLBACK: Board = {
  cards: [
    {
      assignee: "Alex",
      column: "todo",
      id: "c1",
      priority: "High",
      tag: "Architecture",
      title: "Design camera coordinate contract & bounds math",
    },
    {
      assignee: "Sarah",
      column: "todo",
      id: "c4",
      priority: "Medium",
      tag: "UI",
      title: "Unify dot grid background with viewport matrix",
    },
    {
      assignee: "Devin",
      column: "doing",
      id: "c2",
      priority: "High",
      tag: "Engine",
      title: "Implement multi-gesture matrix & middle-click pan",
    },
    {
      assignee: "Team",
      column: "done",
      id: "c3",
      priority: "Normal",
      tag: "Release",
      title: "Ship FlowGraph live status and halo edges",
    },
  ],
  columns: [
    { id: "todo", title: "Ready" },
    { id: "doing", title: "In Progress" },
    { id: "done", title: "Done" },
  ],
};

function parseBoard(text: string): Board | null {
  try {
    const data = JSON.parse(text) as {
      cards?: {
        assignee?: unknown;
        column?: unknown;
        id?: unknown;
        priority?: unknown;
        tag?: unknown;
        title?: unknown;
      }[];
      columns?: { id?: unknown; title?: unknown }[];
    };
    if (!(Array.isArray(data.columns) && Array.isArray(data.cards))) {
      return null;
    }
    const columns = data.columns.flatMap((column) =>
      typeof column.id === "string" && typeof column.title === "string"
        ? [{ id: column.id, title: column.title }]
        : []
    );
    const cards = data.cards.flatMap((card) =>
      typeof card.id === "string" &&
      typeof card.title === "string" &&
      typeof card.column === "string"
        ? [
            {
              assignee:
                typeof card.assignee === "string" ? card.assignee : undefined,
              column: card.column,
              id: card.id,
              priority:
                typeof card.priority === "string" ? card.priority : undefined,
              tag: typeof card.tag === "string" ? card.tag : undefined,
              title: card.title,
            },
          ]
        : []
    );
    return { cards, columns };
  } catch {
    return null;
  }
}

/**
 * Gold for recipe=board. Columns and cards live in board.json; watch keeps
 * other windows in sync. Pier is not a task ledger.
 */
export default function Kanban() {
  const file = useCanvasFile();
  const [board, setBoard] = useState(FALLBACK);
  const [revision, setRevision] = useState<string | null>(null);
  const revisionRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!file.available) {
      return;
    }
    const snapshot = await file.read("board.json");
    const parsed = parseBoard(snapshot.contents);
    if (parsed) {
      setBoard(parsed);
    }
    revisionRef.current = snapshot.revision;
    setRevision(snapshot.revision);
  }, [file]);

  useEffect(() => {
    if (!file.available) {
      return;
    }
    void reload();
    return file.watch("board.json", () => {
      void reload();
    });
  }, [file, reload]);

  async function persist(next: Board) {
    setBoard(next);
    if (!file.available) {
      return;
    }
    const sentRevision = revisionRef.current;
    const outcome = await file.write(
      "board.json",
      `${JSON.stringify({ ...next, schemaVersion: 1 }, null, 2)}\n`,
      sentRevision
    );
    if (outcome.kind === "written") {
      revisionRef.current = outcome.revision;
      setRevision(outcome.revision);
      setNotice(null);
      return;
    }
    if (outcome.kind === "conflict") {
      await reload();
      setNotice("The board changed elsewhere. Reloaded the saved columns.");
      return;
    }
    setNotice(outcome.message);
  }

  function idsIn(column: string): string[] {
    return board.cards
      .filter((card) => card.column === column)
      .map((card) => card.id);
  }

  /** Cross-column move is a single write: column change + insertion index. */
  function moveCard(itemId: string, toColumn: string, index: number) {
    const card = board.cards.find((entry) => entry.id === itemId);
    if (!card) {
      return;
    }
    const targetIds = idsIn(toColumn).filter((id) => id !== itemId);
    targetIds.splice(index, 0, itemId);
    const rest = board.cards.filter(
      (entry) => entry.column !== toColumn && entry.id !== itemId
    );
    const targetCards = targetIds.flatMap((id) => {
      if (id === itemId) {
        return [{ ...card, column: toColumn }];
      }
      const entry = board.cards.find((row) => row.id === id);
      return entry ? [entry] : [];
    });
    void persist({ ...board, cards: [...rest, ...targetCards] });
  }

  return (
    <Stack className="h-full min-h-0 bg-background p-6" fill gap={16}>
      <Row align="center" className="border-border/60 border-b pb-3" justify="between">
        <Row align="center" gap={12}>
          <Text as="h2">Sprint Board</Text>
          <Badge className="font-mono text-xs" variant="secondary">
            {board.cards.length} Tasks
          </Badge>
        </Row>
        <Row align="center" gap={8}>
          <Button
            disabled={!file.available}
            onClick={() => {
              void reload();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Refresh
          </Button>
        </Row>
      </Row>

      {notice ? (
        <Alert>
          <AlertTitle>Couldn’t finish that action</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Row align="stretch" className="min-h-0 flex-1" gap={16} wrap={false}>
        {board.columns.map((column) => {
          const columnIds = idsIn(column.id);
          return (
            <Droppable
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5"
              id={column.id}
              key={column.id}
            >
              <Row align="center" className="px-1" justify="between">
                <Row align="center" gap={8}>
                  <span
                    className={`size-2 rounded-full ${
                      column.id === "done"
                        ? "bg-status-success-fg"
                        : column.id === "doing"
                          ? "bg-status-info-fg"
                          : "bg-muted-foreground"
                    }`}
                  />
                  <Text as="h3">{column.title}</Text>
                </Row>
                <Badge className="rounded-full px-2 py-0 text-[11px]" variant="secondary">
                  {columnIds.length}
                </Badge>
              </Row>

              <Sortable
                className="min-h-0 flex-1 overflow-y-auto pr-0.5"
                items={columnIds}
                onDropItem={(itemId, index) => {
                  moveCard(itemId, column.id, index);
                }}
                onReorder={(ids) => {
                  const others = board.cards.filter(
                    (card) => card.column !== column.id
                  );
                  const reordered = ids.flatMap((id) => {
                    const card = board.cards.find((entry) => entry.id === id);
                    return card ? [{ ...card, column: column.id }] : [];
                  });
                  void persist({ ...board, cards: [...others, ...reordered] });
                }}
              >
                {(itemId) => {
                  const card = board.cards.find((entry) => entry.id === itemId);
                  return (
                    <div className="group relative flex cursor-grab flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-xs transition-all hover:border-border/80 hover:shadow-md active:cursor-grabbing">
                      <Row align="center" justify="between">
                        <Text className="font-mono text-[11px]" tone="secondary">
                          #{card?.id ?? itemId}
                        </Text>
                        {card?.tag ? (
                          <Badge size="xs" variant="outline">
                            {card.tag}
                          </Badge>
                        ) : null}
                      </Row>
                      <Text className="font-medium text-sm text-foreground leading-snug">
                        {card?.title ?? itemId}
                      </Text>
                      {card?.priority || card?.assignee ? (
                        <Row
                          align="center"
                          className="mt-1 border-border/50 border-t pt-2 text-xs"
                          justify="between"
                        >
                          {card.priority ? (
                            <Badge
                              size="xs"
                              variant={
                                card.priority === "High"
                                  ? "warning"
                                  : card.priority === "Urgent"
                                    ? "danger"
                                    : "secondary"
                              }
                            >
                              {card.priority}
                            </Badge>
                          ) : (
                            <span />
                          )}
                          {card.assignee ? (
                            <Text className="text-[11px]" tone="secondary">
                              @{card.assignee}
                            </Text>
                          ) : null}
                        </Row>
                      ) : null}
                    </div>
                  );
                }}
              </Sortable>

              {columnIds.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-border/60 border-dashed py-8 text-muted-foreground text-xs">
                  Drop cards here
                </div>
              ) : null}
            </Droppable>
          );
        })}
      </Row>
    </Stack>
  );
}
