interface ComposerAttachmentJob {
  reject: (reason: unknown) => void;
  resolve: () => void;
  task: () => void | Promise<void>;
}

/** Owns pending attachment work so closing can release it without waiting for IPC. */
export class ComposerAttachmentQueue {
  private readonly pending: ComposerAttachmentJob[] = [];
  private disposed = false;
  private running = false;

  enqueue(task: () => void | Promise<void>): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const result = new Promise<void>((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
    });
    if (!this.running) {
      this.running = true;
      queueMicrotask(() => {
        this.drain();
      });
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const job of this.pending) {
      job.resolve();
    }
    this.pending.length = 0;
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const job = this.pending.shift();
      if (!job) {
        break;
      }
      try {
        await job.task();
        job.resolve();
      } catch (error) {
        job.reject(error);
      }
    }
    this.running = false;
  }
}
