import type { TerminalFrameCommittedEvent } from "@shared/contracts/terminal.ts";

const SAFE_PRESENTATION_ID_HIGH_WORD_RANGE = 0x20_00_00;
const UINT32_RANGE = 0x1_00_00_00_00;

/**
 * 生成可安全穿过 JavaScript Number、N-API int64 与 Swift UInt64 的 53 位令牌。
 * 每次 renderer reload 都重新取系统随机数，避免模块计数器归零后撞到复用终端的旧生命周期。
 */
export function allocateTerminalPresentationId(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  const high = (words[0] ?? 0) % SAFE_PRESENTATION_ID_HIGH_WORD_RANGE;
  const low = words[1] ?? 0;
  return high * UINT32_RANGE + low || 1;
}

export class TerminalNativeFrameGate {
  private created = false;
  private frameCommitted = false;
  private readonly panelId: string;
  private readonly presentationId: number;

  constructor(panelId: string, presentationId: number) {
    this.panelId = panelId;
    this.presentationId = presentationId;
  }

  get isReady(): boolean {
    return this.created && this.frameCommitted;
  }

  markCreated(): boolean {
    this.created = true;
    return this.isReady;
  }

  acceptFrame(event: TerminalFrameCommittedEvent): boolean {
    if (
      event.panelId !== this.panelId ||
      event.presentationId !== this.presentationId
    ) {
      return false;
    }
    this.frameCommitted = true;
    return this.isReady;
  }
}
