export interface TerminalFrameCommittedEvent {
  drawSequence: number;
  panelId: string;
  pixelHeight: number;
  pixelWidth: number;
  presentationId: number;
  requestSequence: number;
  surfaceGeneration: number;
}
