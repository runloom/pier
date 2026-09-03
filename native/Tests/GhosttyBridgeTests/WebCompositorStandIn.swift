import AppKit
@testable import GhosttyBridge

/// Stand-in for Chromium's `ViewsCompositorSuperview`. Production classifies
/// web layers by class name, so the type name must contain that substring.
final class ViewsCompositorSuperviewStandIn: NSView {}

/// Inserts a web-layer stand-in between the terminals (bottom) and the
/// `EventRouterView` (top), mirroring the Electron 43 content view layout.
@MainActor
@discardableResult
func insertWebCompositorStandIn(in window: NSWindow) -> NSView {
    guard let contentView = window.contentView else {
        preconditionFailure("window has no contentView")
    }
    let standIn = ViewsCompositorSuperviewStandIn(frame: contentView.bounds)
    standIn.wantsLayer = true
    standIn.autoresizingMask = [.width, .height]
    contentView.addSubview(standIn, positioned: .above, relativeTo: nil)
    if let router = contentView.subviews.first(where: { $0 is EventRouterView }) {
        contentView.addSubview(router, positioned: .above, relativeTo: nil)
    }
    return standIn
}
