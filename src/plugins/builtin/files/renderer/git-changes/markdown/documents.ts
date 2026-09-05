import type { MarkdownIrDocument } from "../../markdown/ir.ts";
import {
  type MarkdownRuntime,
  markdownRuntime,
} from "../../markdown/runtime.ts";

export interface MarkdownDiffDocuments {
  after: MarkdownIrDocument;
  before: MarkdownIrDocument;
}
interface CachedPair {
  after: string;
  before: string;
  promise: Promise<MarkdownDiffDocuments>;
  runtime: MarkdownRuntime;
}
// One pair per live comparison resource; no global path or document registry.
const pairs = new WeakMap<object, CachedPair>();

export function loadMarkdownDiffDocuments(
  owner: object,
  before: string,
  after: string,
  runtime = markdownRuntime
): Promise<MarkdownDiffDocuments> {
  const current = pairs.get(owner);
  if (
    current?.before === before &&
    current.after === after &&
    current.runtime === runtime
  )
    return current.promise;
  const id = `files-diff:${crypto.randomUUID()}`;
  const beforeSession = `${id}:before`;
  const afterSession = `${id}:after`;
  const parse = async (sessionId: string, source: string) => {
    const outcome = await runtime.parse({ sessionId, source, revision: id });
    if (outcome.status !== "parsed")
      throw new Error("markdown-diff-parse-failed");
    return outcome.document;
  };
  const entry: CachedPair = {
    before,
    after,
    runtime,
    promise: Promise.all([
      parse(beforeSession, before),
      parse(afterSession, after),
    ])
      .then(([oldDocument, newDocument]) => ({
        before: oldDocument,
        after: newDocument,
      }))
      .catch((error: unknown) => {
        if (pairs.get(owner) === entry) pairs.delete(owner);
        throw error;
      })
      .finally(() => {
        runtime.closeSession(beforeSession);
        runtime.closeSession(afterSession);
      }),
  };
  pairs.set(owner, entry);
  return entry.promise;
}
