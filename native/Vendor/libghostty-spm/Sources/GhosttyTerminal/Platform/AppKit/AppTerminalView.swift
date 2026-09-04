//
//  AppTerminalView.swift
//  libghostty-spm
//
//  Created by Lakr233 on 2026/3/16.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit
    import GhosttyKit
    import IOSurface

    @MainActor
    open class AppTerminalView: NSView {
        let core = TerminalSurfaceCoordinator()
        var metalLayer: CAMetalLayer?
        var inputHandler: TerminalKeyEventHandler?
        var lastPerformKeyEvent: TimeInterval?
        var pointerSelectionStartPoint: CGPoint?
        var lastPointerSelectionRect: CGRect?
        var pendingSelectionMenuPoint: CGPoint?
        var pendingHostLinkUrl: String?
        var pendingHostLinkPoint: CGPoint?
        var onFocusChange: ((Bool) -> Void)?
        public var onFramePresentationRequested: ((TerminalFramePresentationRequest) -> Void)?
        public var onFramePresented: ((TerminalFramePresentation) -> Void)?
        // nil means no focus state has reached the surface yet; the first sync
        // must propagate even when it is `false` so inactive terminals do not
        // render an active cursor on creation.
        var appliedSurfaceFocus: Bool?
        open var focusesOnMouseDown = true
        /// Surface focus pin + visual cursor suppress while Rich Input owns keys.
        /// - Focus: keeps Ghostty `focused=true` (no mode-1004 `ESC[O]`).
        /// - Visual: suppress painted cursor so only the composer caret blinks.
        ///   Probe still reads DECTCEM mode bit (patch 0104), not paint state.
        /// `internal` so `synchronizeHostFocusState` can read it.
        var hostCursorHidden = false
        open var hostKeyboardActive = true {
            didSet {
                guard hostKeyboardActive != oldValue else { return }
                core.setCursorSuppress(cursorSuppressed)
                synchronizeHostFocusState()
            }
        }

        /// Host veto for mouse delivery. Pier installs a filter that returns
        /// `false` when the event is over a registered web overlay (dialog
        /// scrim, menus, tooltips). NSTrackingArea on this view can still
        /// deliver `mouseMoved` under a transparent WKWebView; without this
        /// gate, TUI mouse-mode highlights follow the cursor through modals.
        open var hostAllowsMouseEvent: ((NSEvent) -> Bool)?

        /// Visual suppress (patch 0103). Suppress when this terminal lacks
        /// keyboard ownership **or** when Rich Input has focus-disabled pin
        /// (composer open — no dual blinking carets).
        open var cursorSuppressed: Bool {
            !hostKeyboardActive || hostCursorHidden
        }

        /// Pin surface focus + suppress painted cursor for composer takeover.
        /// `force` re-applies even when the cached flag matches (surface rebuild).
        public func setHostCursorHidden(_ hidden: Bool, force: Bool = false) {
            let changed = hostCursorHidden != hidden
            guard force || changed else { return }
            hostCursorHidden = hidden
            if changed {
                NSLog(
                    "[pier] setHostCursorHidden pin=%@ hasSurface=%@ visualSuppress=%@",
                    hidden ? "1" : "0",
                    surface != nil ? "1" : "0",
                    cursorSuppressed ? "1" : "0"
                )
            }
            core.setCursorSuppress(cursorSuppressed)
            if changed {
                synchronizeHostFocusState()
            }
        }

        open weak var delegate: (any TerminalSurfaceViewDelegate)? {
            get { core.delegate }
            set { core.delegate = newValue }
        }

        open var controller: TerminalController? {
            get { core.controller }
            set { core.controller = newValue }
        }

        open var configuration: TerminalSurfaceOptions {
            get { core.configuration }
            set { core.configuration = newValue }
        }

        open func setSurfaceVisible(_ visible: Bool) {
            core.setDisplayVisible(visible)
        }

        /// Live scrollback limit (Pier patch 0108)：即时生效于存量 surface。
        open func setScrollbackLimit(_ bytes: UInt64) {
            core.setScrollbackLimit(bytes)
        }

        /// Raw PTY output tap (Pier patch 0107)。C API 仍在；Pier 宿主
        /// 当前不接线。回调在 ghostty IO 线程持锁触发，只能拷贝后立即返回。
        open func setOutputTap(
            _ callback: ghostty_surface_output_tap_cb?,
            userdata: UnsafeMutableRawPointer?
        ) {
            core.setOutputTap(callback, userdata: userdata)
        }

        @_spi(PierDiagnostics)
        public var pierRenderDiagnostics: TerminalSurfaceRenderDiagnostics {
            core.pierDiagnostics
        }

        var surface: TerminalSurface? {
            core.surface
        }

        override public init(frame: NSRect) {
            super.init(frame: frame)
            commonInit()
        }

        @available(*, unavailable)
        public required init?(coder _: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        func commonInit() {
            wantsLayer = true

            let metal = CAMetalLayer()
            metal.device = MTLCreateSystemDefaultDevice()
            metal.pixelFormat = .bgra8Unorm
            metal.framebufferOnly = true
            metal.contentsScale = NSScreen.main?.backingScaleFactor ?? 2.0
            metal.isOpaque = true
            metal.backgroundColor = NSColor.black.cgColor
            layer = metal
            metalLayer = metal
            layer?.backgroundColor = NSColor.black.cgColor

            inputHandler = TerminalKeyEventHandler(view: self)
            setupTrackingArea()

            core.isAttached = { [weak self] in self?.window != nil }
            core.scaleFactor = { [weak self] in
                Double(
                    self?.window?.backingScaleFactor
                        ?? NSScreen.main?.backingScaleFactor ?? 2.0
                )
            }
            core.viewSize = { [weak self] in
                guard let self else { return (0, 0) }
                return (bounds.width, bounds.height)
            }
            core.platformSetup = { [weak self] config in
                guard let self else { return }
                config.platform_tag = GHOSTTY_PLATFORM_MACOS
                config.platform = ghostty_platform_u(
                    macos: ghostty_platform_macos_s(
                        nsview: Unmanaged.passUnretained(self).toOpaque()
                    )
                )
            }
            core.onMetricsUpdate = { [weak self] in
                self?.updateMetalLayerMetrics()
            }
            core.onMouseShape = { [weak self] shape in
                self?.applyCursor(for: shape)
            }
            core.onMouseVisibility = { [weak self] visible in
                self?.applyCursorVisibility(visible)
            }
            core.onPresentationRequested = { [weak self] request in
                self?.onFramePresentationRequested?(request)
            }
            core.beginFramePresentationTransaction = {
                CATransaction.begin()
                CATransaction.setDisableActions(true)
            }
            core.endFramePresentationTransaction = {
                CATransaction.commit()
            }
            core.onPostRender = { [weak self] presentation in
                guard let self else { return }
                enforceMetalLayerScale()
                guard let surface = layer?.contents as? IOSurface else {
                    TerminalDebugLog.log(
                        .render,
                        "frame presentation rejected: layer has no IOSurface contents"
                    )
                    return
                }
                let actualWidth = UInt32(clamping: IOSurfaceGetWidth(surface))
                let actualHeight = UInt32(clamping: IOSurfaceGetHeight(surface))
                guard actualWidth == presentation.pixelWidth,
                      actualHeight == presentation.pixelHeight
                else {
                    TerminalDebugLog.log(
                        .render,
                        "frame presentation rejected: IOSurface=\(actualWidth)x\(actualHeight) expected=\(presentation.pixelWidth)x\(presentation.pixelHeight)"
                    )
                    return
                }
                onFramePresented?(presentation)
            }
        }

        open func selectionMenuPoint(at point: CGPoint) -> CGPoint? {
            guard surface?.hasSelection() == true else {
                TerminalDebugLog.log(
                    .input,
                    "selection menu miss point=\(selectionPointDescription(point))"
                )
                return nil
            }

            if let rect = lastPointerSelectionRect {
                guard rect.insetBy(dx: -4, dy: -4).contains(point) else {
                    TerminalDebugLog.log(
                        .input,
                        "selection menu miss point=\(selectionPointDescription(point)) outside pointer selection"
                    )
                    return nil
                }

                TerminalDebugLog.log(
                    .input,
                    "selection menu hit point=\(selectionPointDescription(point)) inside pointer selection"
                )
                return point
            }

            guard surface?.selectionContainsQuicklookWord() == true else {
                TerminalDebugLog.log(
                    .input,
                    "selection menu miss point=\(selectionPointDescription(point)) outside quicklook word"
                )
                return nil
            }

            TerminalDebugLog.log(
                .input,
                "selection menu hit point=\(selectionPointDescription(point))"
            )
            return point
        }

        open func selectionContextMenu() -> NSMenu {
            let menu = NSMenu()
            let copyItem = NSMenuItem(
                title: "Copy",
                action: #selector(copy(_:)),
                keyEquivalent: ""
            )
            copyItem.target = self
            menu.addItem(copyItem)
            return menu
        }

        @discardableResult
        open func copySelectedTextToPasteboard() -> Bool {
            guard surface?.hasSelection() == true else {
                return false
            }
            guard surface?.performBindingAction("copy_to_clipboard") == true else {
                return false
            }
            TerminalDebugLog.log(
                .input,
                "selection copied to clipboard"
            )
            return true
        }

        private func selectionPointDescription(_ point: CGPoint) -> String {
            "\(String(format: "%.2f", point.x))x\(String(format: "%.2f", point.y))"
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }
    }
#endif
