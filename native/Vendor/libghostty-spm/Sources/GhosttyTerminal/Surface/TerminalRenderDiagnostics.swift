import Foundation

@_spi(PierDiagnostics)
public struct TerminalSurfaceRenderDiagnostics: Sendable {
    public let drawPending: Bool
    public let drawSequence: UInt64
    public let ghosttyRenderReadySequence: UInt64
    public let hostRefreshRequestSequence: UInt64
    public let lastDrawUptime: TimeInterval?
    public let lastDrawnGhosttyRenderReadySequence: UInt64
    public let lastRenderReadyUptime: TimeInterval?
    public let refreshPending: Bool
    public let surfaceGeneration: UInt64

    public init(
        drawPending: Bool,
        drawSequence: UInt64,
        ghosttyRenderReadySequence: UInt64,
        hostRefreshRequestSequence: UInt64,
        lastDrawUptime: TimeInterval?,
        lastDrawnGhosttyRenderReadySequence: UInt64,
        lastRenderReadyUptime: TimeInterval?,
        refreshPending: Bool,
        surfaceGeneration: UInt64
    ) {
        self.drawPending = drawPending
        self.drawSequence = drawSequence
        self.ghosttyRenderReadySequence = ghosttyRenderReadySequence
        self.hostRefreshRequestSequence = hostRefreshRequestSequence
        self.lastDrawUptime = lastDrawUptime
        self.lastDrawnGhosttyRenderReadySequence = lastDrawnGhosttyRenderReadySequence
        self.lastRenderReadyUptime = lastRenderReadyUptime
        self.refreshPending = refreshPending
        self.surfaceGeneration = surfaceGeneration
    }
}
