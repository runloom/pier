import { useState } from "react";
import { appletChrome } from "../chrome.ts";
import { firstColumnIdOfKind } from "./columns.ts";
import { type TrackerBoardProps, useTrackerBoard } from "./hooks.ts";
import { TrackerBoardView } from "./view.tsx";

export default function TrackerBoardApplet(props: TrackerBoardProps) {
  const board = useTrackerBoard(props);
  const [actionError, setActionError] = useState<string | null>(null);
  // Write failures must be visible: optimistic state rolls back in the hook,
  // and the message surfaces in the board-level alert.
  const runAction = (work: Promise<unknown>) => {
    work
      .then(() => {
        setActionError(null);
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <TrackerBoardView
      actions={{
        onConfirmDone: (itemKey) => {
          const doneId =
            firstColumnIdOfKind(board.board?.columns ?? [], "done") ?? "done";
          runAction(board.moveCard(itemKey, doneId, true));
        },
        onFocusWork: (panelId) => {
          runAction(board.focusWork(panelId));
        },
        onMove: (itemKey, columnId, index) => {
          runAction(board.moveCard(itemKey, columnId, false, index));
        },
        onOpenIssue: (url) => {
          runAction(board.openIssue(url));
        },
        onPrune: (itemKey) => {
          runAction(board.pruneWork(itemKey));
        },
        onReconnect: () => {
          runAction(board.reconnect());
        },
        onRefresh: () => {
          runAction(board.refresh());
        },
        onStartAllReady: () => {
          runAction(board.startAllReady());
        },
        onStartWork: (itemKey) => {
          runAction(board.startWork(itemKey));
        },
      }}
      activityByPanel={board.activityByPanel}
      board={board.board}
      chrome={appletChrome(props, "panel")}
      error={board.error ?? actionError}
      repo={props.repo}
      status={board.status}
    />
  );
}
