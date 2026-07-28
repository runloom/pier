import {
  Badge,
  Button,
  Frame,
  Separator,
  Text,
} from "pier/canvas";
import { useState } from "react";
import {
  BoundarySurface,
  OverviewSurface,
  PlaygroundSurface,
} from "./canvas-capabilities.capabilities.tsx";
import {
  RouteSurface,
  VerificationSurface,
} from "./canvas-capabilities.execution.tsx";
import {
  DEFAULT_LEVEL,
  DEFAULT_TASK,
  INITIAL_COMPLETED,
  INTERACTION_LEVELS,
  SURFACES,
  TASKS,
  type BoundaryView,
  type InteractionLevel,
  type Surface,
  type TaskId,
  descendantsOf,
} from "./canvas-capabilities.model.ts";
import { CANVAS_CAPABILITIES_STYLES } from "./canvas-capabilities.styles.ts";

export default function CanvasCapabilitiesCanvas() {
  const [surface, setSurface] = useState<Surface>("overview");
  const [boundaryView, setBoundaryView] = useState<BoundaryView>("freedom");
  const [interactionLevel, setInteractionLevel] =
    useState<InteractionLevel>("local");
  const [selectedTaskId, setSelectedTaskId] = useState<TaskId>("T7");
  const [completed, setCompleted] = useState(
    () => new Set<TaskId>(INITIAL_COMPLETED)
  );

  const selectedLevel =
    INTERACTION_LEVELS.find((item) => item.id === interactionLevel) ??
    DEFAULT_LEVEL;
  const selectedTask =
    TASKS.find((task) => task.id === selectedTaskId) ?? DEFAULT_TASK;

  const setTaskCompletion = (id: TaskId, checked: boolean) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (checked) {
        const task = TASKS.find((candidate) => candidate.id === id);
        if (task?.deps.every((dependency) => next.has(dependency))) {
          next.add(id);
        }
      } else {
        next.delete(id);
        for (const descendant of descendantsOf(id)) {
          next.delete(descendant);
        }
      }
      return next;
    });
  };

  const activeSurface =
    surface === "overview" ? (
      <OverviewSurface />
    ) : surface === "playground" ? (
      <PlaygroundSurface />
    ) : surface === "boundary" ? (
      <BoundarySurface
        activeView={boundaryView}
        setActiveView={setBoundaryView}
      />
    ) : surface === "verification" ? (
      <VerificationSurface
        selected={selectedLevel}
        selectedId={interactionLevel}
        setSelectedId={setInteractionLevel}
      />
    ) : (
      <RouteSurface
        completed={completed}
        selected={selectedTask}
        selectedId={selectedTaskId}
        setCompleted={setTaskCompletion}
        setSelectedId={setSelectedTaskId}
      />
    );

  return (
    <Frame maxWidth={1220}>
      <style>{CANVAS_CAPABILITIES_STYLES}</style>
      <div data-canvas-capabilities="">
        <CanvasHeader surface={surface} setSurface={setSurface} />
        <div className="cc-question">
          <span>{SURFACES.find((item) => item.id === surface)?.label}回答</span>
          <strong>
            {SURFACES.find((item) => item.id === surface)?.question}
          </strong>
          <span className="cc-question__tail">
            {SURFACES.find((item) => item.id === surface)?.tail}
          </span>
        </div>

        {SURFACES.map((item) => (
          <div
            aria-labelledby={`cc-surface-tab-${item.id}`}
            className="cc-surface-panel"
            hidden={surface !== item.id}
            id={`cc-surface-panel-${item.id}`}
            key={item.id}
            role="tabpanel"
          >
            {surface === item.id ? activeSurface : null}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function CanvasHeader({
  setSurface,
  surface,
}: {
  setSurface: (surface: Surface) => void;
  surface: Surface;
}) {
  return (
    <header className="cc-header">
      <div className="cc-brand">
        <span className="cc-brand__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="cc-kicker">PIER / DIAGRAM CORE</span>
      </div>
      <Separator orientation="vertical" />
      <div className="cc-heading">
        <Text as="h1">Canvas 能力与自由度闭环</Text>
        <div className="cc-heading__meta">
          <Badge variant="info">内部验证</Badge>
          <Badge variant="done">图表底层已接入</Badge>
          <Badge variant="warning">壳层边界待实现</Badge>
        </div>
      </div>
      <nav
        aria-label="Canvas 能力视图"
        className="cc-nav"
        role="tablist"
      >
        {SURFACES.map((item, index) => (
          <Button
            key={item.id}
            aria-controls={`cc-surface-panel-${item.id}`}
            aria-selected={surface === item.id}
            id={`cc-surface-tab-${item.id}`}
            onClick={() => setSurface(item.id)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (direction === 0) {
                return;
              }
              event.preventDefault();
              const next =
                SURFACES[
                  (index + direction + SURFACES.length) % SURFACES.length
                ];
              if (!next) {
                return;
              }
              setSurface(next.id);
              document.getElementById(`cc-surface-tab-${next.id}`)?.focus();
            }}
            role="tab"
            size="sm"
            tabIndex={surface === item.id ? 0 : -1}
            type="button"
            variant={surface === item.id ? "secondary" : "ghost"}
          >
            {item.label}
            <span className="cc-nav__key">{index + 1}</span>
          </Button>
        ))}
      </nav>
    </header>
  );
}
