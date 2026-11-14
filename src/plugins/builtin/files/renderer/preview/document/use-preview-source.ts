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

/**
 * Deleted-on-disk documents must keep showing their last preview. The bytes
 * cannot be fetched again, so the most recent successful reads stay in a
 * small LRU owned by the renderer session, keyed by the content revision.
 */
const MAX_RETAINED_PREVIEW_BYTES = MAX_FILE_PREVIEW_BYTES;
const MAX_RETAINED_PREVIEWS = 8;
const retainedPreviews = new Map<string, Uint8Array>();
let retainedPreviewBytes = 0;

function previewCacheKey(root: string, path: string, revision: string): string {
  return `${root}\u0000${path}\u0000${revision}`;
}

function readRetainedPreview(key: string): Uint8Array | null {
  const bytes = retainedPreviews.get(key);
  if (!bytes) {
    return null;
  }
  // Refresh LRU position.
  retainedPreviews.delete(key);
  retainedPreviews.set(key, bytes);
  return bytes;
}

function retainPreview(key: string, bytes: Uint8Array): void {
  const existing = retainedPreviews.get(key);
  if (existing) {
    retainedPreviewBytes -= existing.byteLength;
    retainedPreviews.delete(key);
  }
  retainedPreviews.set(key, bytes);
  retainedPreviewBytes += bytes.byteLength;
  while (
    retainedPreviews.size > MAX_RETAINED_PREVIEWS ||
    retainedPreviewBytes > MAX_RETAINED_PREVIEW_BYTES
  ) {
    const oldestKey = retainedPreviews.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = retainedPreviews.get(oldestKey);
    retainedPreviews.delete(oldestKey);
    retainedPreviewBytes -= oldest?.byteLength ?? 0;
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
 *
 * When `deletedOnDisk` is set and no retained bytes exist, do not issue a
 * ticket for a path that no longer exists: report the deletion instead of a
 * misleading fetch failure.
 */
export function usePreviewSource(args: {
  context: DocumentPreviewContext;
  deletedOnDisk?: boolean;
  mime: string;
  path: string;
  revision: string;
  root: string;
}): PreviewSourceState & { retry: () => void } {
  const { context, deletedOnDisk = false, mime, path, revision, root } = args;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewSourceState>(() => {
    const retained = readRetainedPreview(previewCacheKey(root, path, revision));
    return retained
      ? { bytes: retained, error: null, status: "ready" }
      : { bytes: null, error: null, status: "loading" };
  });
  const ticketRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` explicitly retries a failed fetch.
  useEffect(() => {
    const cacheKey = previewCacheKey(root, path, revision);
    const retained = readRetainedPreview(cacheKey);
    if (retained) {
      setState({ bytes: retained, error: null, status: "ready" });
      return;
    }
    if (deletedOnDisk) {
      setState({ bytes: null, error: "deleted", status: "error" });
      return;
    }

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
        const bytes = new Uint8Array(buffer);
        retainPreview(cacheKey, bytes);
        setState({
          bytes,
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
  }, [attempt, context, deletedOnDisk, mime, path, revision, root]);

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
