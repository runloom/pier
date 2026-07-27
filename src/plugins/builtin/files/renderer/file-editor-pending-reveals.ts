/**
 * Queue editor selection reveals until the CodeMirror session attaches.
 */
export interface EditorRevealRange {
  from: number;
  to: number;
}

export interface EditorRevealSession {
  revealRange(from: number, to: number): void;
}

export class FileEditorPendingReveals {
  readonly #pending = new Map<string, EditorRevealRange>();

  get map(): Map<string, EditorRevealRange> {
    return this.#pending;
  }

  /**
   * Reveal a selection range. Returns true when applied to a live session;
   * false when queued for attach (caller may keep retrying).
   */
  revealRange(
    session: EditorRevealSession | undefined,
    editorSessionId: string,
    from: number,
    to: number
  ): boolean {
    if (session) {
      session.revealRange(from, to);
      this.#pending.delete(editorSessionId);
      return true;
    }
    this.#pending.set(editorSessionId, {
      from: Math.min(from, to),
      to: Math.max(from, to),
    });
    return false;
  }

  clear(): void {
    this.#pending.clear();
  }
}
