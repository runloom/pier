import { useEffect, useRef, useState } from "react";
import type { MarkdownPreviewState } from "../preview-types.ts";
import type { MarkdownRuntime } from "../runtime.ts";

interface ParsedIdentity {
  runtime: MarkdownRuntime;
  sessionId: string;
  value: string;
}

/**
 * 解析生命周期与 ready 缓存的唯一来源。
 *
 * Dockview 面板隐藏时 `PanelResourceBoundary` 用 React `<Activity>` 卸掉
 * effects、保留 state/ref；重新可见会重跑 parse effect。若同一 runtime /
 * session / 源文已经产出过 ready，直接复用已渲染的 document + pagination，
 * 不再重新 parse——否则每次切 tab 都重建整棵 IR、重新分配并重渲染。
 */
export function useMarkdownPreviewParse(input: {
  runtime: MarkdownRuntime;
  sessionId: string;
  value: string;
}): MarkdownPreviewState {
  const { runtime, sessionId, value } = input;
  const [state, setState] = useState<MarkdownPreviewState>({
    status: "loading",
  });
  const revisionRef = useRef(0);
  const parsedIdentityRef = useRef<ParsedIdentity | null>(null);

  useEffect(() => {
    const parsed = parsedIdentityRef.current;
    if (
      parsed !== null &&
      parsed.runtime === runtime &&
      parsed.sessionId === sessionId &&
      parsed.value === value
    ) {
      return;
    }
    let active = true;
    revisionRef.current += 1;
    const revision = `${sessionId}:${revisionRef.current}`;
    // Same-document live updates (disk reload / buffer change): keep the
    // previous ready render while the newer revision parses. First paint and
    // document identity remounts (see adapter key={documentId}) use skeleton.
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" }
    );
    runtime
      .parse({ revision, sessionId, source: value })
      .then((outcome) => {
        if (!(active && outcome.revision === revision)) return;
        if (outcome.status === "parsed") {
          parsedIdentityRef.current = { runtime, sessionId, value };
          setState({
            document: outcome.document,
            sourceValue: value,
            pagination: outcome.pagination,
            status: "ready",
          });
        } else if (outcome.status === "error") {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [runtime, sessionId, value]);

  return state;
}
