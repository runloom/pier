import { MAX_FILE_PREVIEW_BYTES } from "@shared/contracts/file/document.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentPreviewContext,
  PreviewSourceError,
  PreviewSourceState,
} from "./types.ts";

class PreviewSourceFailure extends Error {
  readonly error: PreviewSourceError;

  constructor(error: PreviewSourceError) {
    super(error);
    this.name = "PreviewSourceFailure";
    this.error = error;
  }
}

function failureError(error: unknown): PreviewSourceError {
  if (error instanceof PreviewSourceFailure) {
    return error.error;
  }
  return "fetch-failed";
}

function issueError(reason: string): PreviewSourceError {
  return reason === "too-large" ? "too-large" : "fetch-failed";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Issue one preview ticket, fetch the whole document once, then release the
 * ticket immediately after the bytes are in memory. No Range, no second fetch.
 */
export function usePreviewSource(args: {
  context: DocumentPreviewContext;
  mime: string;
  path: string;
  revision: string;
  root: string;
}): PreviewSourceState & { retry: () => void } {
  const { context, mime, path, revision, root } = args;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewSourceState>({
    bytes: null,
    error: null,
    status: "loading",
  });
  const ticketRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` explicitly retries a failed fetch.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let ticket: string | null = null;

    setState({ bytes: null, error: null, status: "loading" });

    const releaseTicket = () => {
      const value = ticket;
      ticket = null;
      if (value) {
        ticketRef.current = null;
        context.filePreviews.release(value).catch(() => undefined);
      }
    };

    const run = async () => {
      try {
        const issued = await context.filePreviews.issue({
          mime,
          path,
          revision,
          root,
        });
        if (!issued.issued) {
          if (!cancelled) {
            setState({
              bytes: null,
              error: issueError(issued.reason),
              status: "error",
            });
          }
          return;
        }
        ticket = issued.ticket;
        ticketRef.current = ticket;
        if (cancelled) {
          releaseTicket();
          return;
        }
        const response = await fetch(issued.url, {
          signal: controller.signal,
        });
        if (response.status === 409) {
          throw new PreviewSourceFailure("stale");
        }
        if (response.status === 413) {
          throw new PreviewSourceFailure("too-large");
        }
        if (!response.ok) {
          throw new PreviewSourceFailure("fetch-failed");
        }
        if (response.headers.get("content-type") !== mime) {
          throw new PreviewSourceFailure("fetch-failed");
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_FILE_PREVIEW_BYTES) {
          throw new PreviewSourceFailure("too-large");
        }
        if (cancelled) {
          return;
        }
        setState({
          bytes: new Uint8Array(buffer),
          error: null,
          status: "ready",
        });
      } catch (error) {
        if (!(cancelled || isAbortError(error))) {
          setState({
            bytes: null,
            error: failureError(error),
            status: "error",
          });
        }
      } finally {
        releaseTicket();
      }
    };

    run().catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
      releaseTicket();
    };
  }, [attempt, context, mime, path, revision, root]);

  useEffect(
    () => () => {
      const ticket = ticketRef.current;
      if (ticket) {
        ticketRef.current = null;
        context.filePreviews.release(ticket).catch(() => undefined);
      }
    },
    [context]
  );

  return { ...state, retry };
}
