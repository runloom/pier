import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Droppable,
  Row,
  Sortable,
  Stack,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useEffect, useRef, useState } from "react";

/**
 * Starter for recipe=board: full-bleed kanban persisted to a sibling
 * `board.json`. Writes are queued so overlapping drops do not collide.
 * A conflict from another window reloads the disk copy.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Composition notes (this template doubles as a reference):
 * - `Text` sizing/weight/color come from `as` + `tone` variants (inline
 *   styles own typography; `text-*` / `font-*` classes would be ignored).
 *   Font-family classes like `font-mono` still apply.
 * - `Row` alignment comes from `align` / `justify` / `wrap` props — CSS
 *   values, e.g. `justify="space-between"`.
 */
export const canvas = {
  description: "Full-bleed board with drag-and-drop columns.",
  kind: "composition" as const,
  title: "Board",
};

const BOARD_FILE = "board.json";

type Card = {
  assignee?: string | undefined;
  column: string;
  id: string;
  priority?: string | undefined;
  tag?: string | undefined;
  title: string;
};

const COLUMNS = [
  { id: "todo", title: "Ready" },
  { id: "doing", title: "In Progress" },
  { id: "done", title: "Done" },
] as const;

const STARTER_CARDS: Card[] = [
  {
    assignee: "Alex",
    column: "todo",
    id: "c1",
    priority: "High",
    tag: "Design",
    title: "Write the spec",
  },
  {
    assignee: "Sarah",
    column: "doing",
    id: "c2",
    priority: "Medium",
    tag: "Review",
    title: "Review the board",
  },
  {
    assignee: "Team",
    column: "done",
    id: "c3",
    priority: "Normal",
    tag: "Release",
    title: "Ship",
  },
];

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.column === "string"
  );
}

function parseBoard(contents: string): Card[] | null {
  try {
    const doc = JSON.parse(contents) as { cards?: unknown };
    if (Array.isArray(doc.cards) && doc.cards.every(isCard)) {
      return doc.cards;
    }
  } catch {
    // Malformed board.json: keep the current in-memory cards.
  }
  return null;
}

function serializeBoard(cards: readonly Card[]): string {
  return `${JSON.stringify({ cards, schemaVersion: 1 }, null, 2)}\n`;
}

function movedCards(
  current: readonly Card[],
  itemId: string,
  toColumn: string,
  index: number
): Card[] {
  const card = current.find((entry) => entry.id === itemId);
  if (!card) {
    return [...current];
  }
  const targetIds = current
    .filter((entry) => entry.column === toColumn && entry.id !== itemId)
    .map((entry) => entry.id);
  targetIds.splice(index, 0, itemId);
  const rest = current.filter(
    (entry) => entry.column !== toColumn && entry.id !== itemId
  );
  const target = targetIds.flatMap((id) => {
    if (id === itemId) {
      return [{ ...card, column: toColumn }];
    }
    const entry = current.find((row) => row.id === id);
    return entry ? [entry] : [];
  });
  return [...rest, ...target];
}

export default function KanbanCanvas() {
  const file = useCanvasFile();
  const [cards, setCards] = useState(STARTER_CARDS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cardsRef = useRef(STARTER_CARDS);
  /** Disk revision for optimistic writes; null until board.json exists. */
  const revisionRef = useRef<string | null>(null);
  const persistBusyRef = useRef(false);
  const persistTailRef = useRef(Promise.resolve());

  useEffect(() => {
    if (!file.available) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const doc = await file.read(BOARD_FILE);
        if (
          cancelled ||
          persistBusyRef.current ||
          doc.revision === revisionRef.current
        ) {
          return;
        }
        revisionRef.current = doc.revision;
        const parsed = parseBoard(doc.contents);
        if (parsed) {
          cardsRef.current = parsed;
          setCards(parsed);
        }
      } catch {
        // Missing board.json: keep starter. Do not clear a revision a write
        // already stored (a slow 404 must not race a successful persist).
      }
    };
    load();
    const unsubscribe = file.watch(BOARD_FILE, () => {
      load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [file]);

  async function persistLatest(): Promise<void> {
    if (!file.available) {
      return;
    }
    persistBusyRef.current = true;
    try {
      const outcome = await file.write(
        BOARD_FILE,
        serializeBoard(cardsRef.current),
        revisionRef.current
      );
      if (outcome.kind === "written") {
        revisionRef.current = outcome.revision;
        setSaveError(null);
        return;
      }
      if (outcome.kind === "conflict") {
        try {
          const doc = await file.read(BOARD_FILE);
          revisionRef.current = doc.revision;
        } catch {
          // Next chained write retries with the latest local cards.
        }
        return;
      }
      setSaveError(outcome.message);
    } finally {
      persistBusyRef.current = false;
    }
  }

  function applyCards(next: Card[]): void {
    cardsRef.current = next;
    setCards(next);
    persistTailRef.current = persistTailRef.current
      .then(() => persistLatest())
      .catch(() => undefined);
  }

  function idsIn(column: string): string[] {
    return cards
      .filter((card) => card.column === column)
      .map((card) => card.id);
  }

  return (
    <Stack className="h-full min-h-0 bg-background p-6" fill gap={16}>
      <Row
        className="border-border/60 border-b pb-3"
        justify="space-between"
      >
        <Row gap={12}>
          <Text as="h2">Board</Text>
          <Badge className="font-mono text-xs" variant="secondary">
            {cards.length} Tasks
          </Badge>
        </Row>
      </Row>

      {saveError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't save the board</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}

      <Row align="stretch" className="min-h-0 flex-1" gap={16} wrap={false}>
        {COLUMNS.map((column) => {
          const columnIds = idsIn(column.id);
          return (
            <Droppable
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5"
              id={column.id}
              key={column.id}
            >
              <Row className="px-1" justify="space-between">
                <Text as="h3">{column.title}</Text>
                <Badge className="rounded-full px-2 py-0" variant="secondary">
                  {columnIds.length}
                </Badge>
              </Row>
              {columnIds.length === 0 ? (
                <Text as="span" className="px-1" tone="tertiary">
                  Drop cards here
                </Text>
              ) : null}
              <Sortable
                className="min-h-0 flex-1 overflow-y-auto pr-0.5"
                items={columnIds}
                onDropItem={(itemId, index) => {
                  applyCards(
                    movedCards(cardsRef.current, itemId, column.id, index)
                  );
                }}
                onReorder={(ids) => {
                  const others = cardsRef.current.filter(
                    (card) => card.column !== column.id
                  );
                  const reordered = ids.flatMap((id) => {
                    const card = cardsRef.current.find(
                      (entry) => entry.id === id
                    );
                    return card ? [{ ...card, column: column.id }] : [];
                  });
                  applyCards([...others, ...reordered]);
                }}
              >
                {(itemId) => {
                  const card = cards.find((entry) => entry.id === itemId);
                  return (
                    <div className="group relative flex cursor-grab flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-xs hover:border-border/80 hover:shadow-md active:cursor-grabbing">
                      <Row justify="space-between">
                        <Text
                          as="span"
                          className="font-mono"
                          tone="secondary"
                        >
                          #{card?.id ?? itemId}
                        </Text>
                        {card?.tag ? (
                          <Badge size="xs" variant="outline">
                            {card.tag}
                          </Badge>
                        ) : null}
                      </Row>
                      <Text>{card?.title ?? itemId}</Text>
                      {card?.priority || card?.assignee ? (
                        <Row
                          className="mt-1 border-border/50 border-t pt-2"
                          justify="space-between"
                        >
                          {card.priority ? (
                            <Badge
                              size="xs"
                              variant={
                                card.priority === "High"
                                  ? "warning"
                                  : "secondary"
                              }
                            >
                              {card.priority}
                            </Badge>
                          ) : (
                            <span />
                          )}
                          {card.assignee ? (
                            <Text as="span" tone="secondary">
                              @{card.assignee}
                            </Text>
                          ) : null}
                        </Row>
                      ) : null}
                    </div>
                  );
                }}
              </Sortable>
            </Droppable>
          );
        })}
      </Row>
    </Stack>
  );
}
