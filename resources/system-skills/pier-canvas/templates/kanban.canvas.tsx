import {
  Badge,
  Droppable,
  Row,
  Sortable,
  Stack,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useState } from "react";

/**
 * Starter for recipe=board: full-bleed kanban.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Persist columns/cards in board.json. This canvas is a viewer, not a ledger.
 */
export const canvas = {
  description: "Full-bleed board with drag-and-drop columns.",
  kind: "composition" as const,
  title: "Board",
};

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

export default function KanbanCanvas() {
  const file = useCanvasFile();
  const [cards, setCards] = useState(STARTER_CARDS);

  function idsIn(column: string): string[] {
    return cards.filter((card) => card.column === column).map((card) => card.id);
  }

  /** Cross-column move is a single state update: column + insertion index. */
  function moveCard(itemId: string, toColumn: string, index: number) {
    setCards((current) => {
      const card = current.find((entry) => entry.id === itemId);
      if (!card) {
        return current;
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
    });
  }

  return (
    <Stack className="h-full min-h-0 bg-background p-6" fill gap={16}>
      <Row align="center" className="border-border/60 border-b pb-3" justify="between">
        <Row align="center" gap={12}>
          <Text as="h2">Board</Text>
          <Badge className="font-mono text-xs" variant="secondary">
            {cards.length} Tasks
          </Badge>
        </Row>
      </Row>

      <Row
        align="stretch"
        className="min-h-0 flex-1"
        gap={16}
        wrap={false}
      >
        {COLUMNS.map((column) => {
          const columnIds = idsIn(column.id);
          return (
            <Droppable
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5"
              id={column.id}
              key={column.id}
            >
              <Row align="center" className="px-1" justify="between">
                <Text as="h3">{column.title}</Text>
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
                  setCards((current) => {
                    const others = current.filter(
                      (card) => card.column !== column.id
                    );
                    const reordered = ids.flatMap((id) => {
                      const card = current.find((entry) => entry.id === id);
                      return card ? [{ ...card, column: column.id }] : [];
                    });
                    return [...others, ...reordered];
                  });
                }}
              >
                {(itemId) => {
                  const card = cards.find((entry) => entry.id === itemId);
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
            </Droppable>
          );
        })}
      </Row>
    </Stack>
  );
}
