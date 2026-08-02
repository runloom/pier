/**
 * Queue editor selection reveals until the CodeMirror session attaches.
 */
export interface EditorRevealRange {
  documentId: string;
  from: number;
  to: number;
}

export interface EditorRevealLocation {
  column?: number | undefined;
  documentId: string;
  line: number;
}

export interface EditorRevealSession {
  currentLine(): number | null;
  readonly documentId: string;
  revealRange(from: number, to: number): void;
}

export class FileEditorPendingReveals {
  readonly #pending = new Map<string, EditorRevealRange>();
  readonly #pendingLocations = new Map<string, EditorRevealLocation>();

  get map(): Map<string, EditorRevealRange> {
    return this.#pending;
  }

  cancel(editorSessionId: string): void {
    this.#pending.delete(editorSessionId);
    this.#pendingLocations.delete(editorSessionId);
  }

  /** True when a range or line location is queued for this session/document. */
  hasPending(editorSessionId: string, documentId?: string): boolean {
    const range = this.#pending.get(editorSessionId);
    if (range) {
      return documentId === undefined || range.documentId === documentId;
    }
    const location = this.#pendingLocations.get(editorSessionId);
    if (location) {
      return documentId === undefined || location.documentId === documentId;
    }
    return false;
  }

  queueLocation(
    editorSessionId: string,
    documentId: string,
    line: number,
    column?: number
  ): void {
    this.#pending.delete(editorSessionId);
    this.#pendingLocations.set(editorSessionId, {
      ...(column === undefined ? {} : { column }),
      documentId,
      line,
    });
  }

  /**
   * Reveal a selection range. Returns true only when applied to the mounted
   * session for the requested document.
   */
  revealRange(
    session: EditorRevealSession | undefined,
    editorSessionId: string,
    documentId: string,
    from: number,
    to: number
  ): boolean {
    if (session && session.documentId !== documentId) {
      this.cancel(editorSessionId);
      return false;
    }
    this.#pendingLocations.delete(editorSessionId);
    if (session && session.currentLine() !== null) {
      session.revealRange(from, to);
      this.#pending.delete(editorSessionId);
      return true;
    }
    this.#pending.set(editorSessionId, {
      documentId,
      from: Math.min(from, to),
      to: Math.max(from, to),
    });
    return false;
  }

  takeLocation(
    editorSessionId: string,
    documentId: string
  ): EditorRevealLocation | null {
    const reveal = this.#pendingLocations.get(editorSessionId);
    if (!reveal) {
      return null;
    }
    this.#pendingLocations.delete(editorSessionId);
    return reveal.documentId === documentId ? reveal : null;
  }

  take(editorSessionId: string, documentId: string): EditorRevealRange | null {
    const reveal = this.#pending.get(editorSessionId);
    if (!reveal) {
      return null;
    }
    this.#pending.delete(editorSessionId);
    return reveal.documentId === documentId ? reveal : null;
  }

  clear(): void {
    this.#pending.clear();
    this.#pendingLocations.clear();
  }
}
