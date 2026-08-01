import Foundation

public struct TerminalFramePresentationRequest: Equatable, Sendable {
    public let pixelHeight: UInt32
    public let pixelWidth: UInt32
    public let requestSequence: UInt64
    public let surfaceGeneration: UInt64

    public init(
        pixelHeight: UInt32,
        pixelWidth: UInt32,
        requestSequence: UInt64,
        surfaceGeneration: UInt64
    ) {
        self.pixelHeight = pixelHeight
        self.pixelWidth = pixelWidth
        self.requestSequence = requestSequence
        self.surfaceGeneration = surfaceGeneration
    }
}

public struct TerminalFramePresentation: Equatable, Sendable {
    public let drawSequence: UInt64
    public let pixelHeight: UInt32
    public let pixelWidth: UInt32
    public let requestSequence: UInt64
    public let surfaceGeneration: UInt64

    public init(
        drawSequence: UInt64,
        pixelHeight: UInt32,
        pixelWidth: UInt32,
        requestSequence: UInt64,
        surfaceGeneration: UInt64
    ) {
        self.drawSequence = drawSequence
        self.pixelHeight = pixelHeight
        self.pixelWidth = pixelWidth
        self.requestSequence = requestSequence
        self.surfaceGeneration = surfaceGeneration
    }
}

@_spi(PierDiagnostics)
public struct TerminalSurfaceRenderDiagnostics: Sendable {
    public let drawPending: Bool
    public let drawSequence: UInt64
    public let framePresentationRequestSequence: UInt64
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
        framePresentationRequestSequence: UInt64,
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
        self.framePresentationRequestSequence = framePresentationRequestSequence
        self.ghosttyRenderReadySequence = ghosttyRenderReadySequence
        self.hostRefreshRequestSequence = hostRefreshRequestSequence
        self.lastDrawUptime = lastDrawUptime
        self.lastDrawnGhosttyRenderReadySequence = lastDrawnGhosttyRenderReadySequence
        self.lastRenderReadyUptime = lastRenderReadyUptime
        self.refreshPending = refreshPending
        self.surfaceGeneration = surfaceGeneration
    }
}
