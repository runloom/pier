//
//  AppTerminalView.swift
//  libghostty-spm
//
//  Created by Lakr233 on 2026/3/16.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit
    import GhosttyKit

    @MainActor
    open class AppTerminalView: NSView {
        let core = TerminalSurfaceCoordinator()
        var metalLayer: CAMetalLayer?
        var inputHandler: TerminalKeyEventHandler?
        var lastPerformKeyEvent: TimeInterval?
        var pointerSelectionStartPoint: CGPoint?
        var lastPointerSelectionRect: CGRect?
        var pendingSelectionMenuPoint: CGPoint?
        var onFocusChange: ((Bool) -> Void)?
        // nil means no focus state has reached the surface yet; the first sync
        // must propagate even when it is `false` so inactive terminals do not
        // render an active cursor on creation.
        var appliedSurfaceFocus: Bool?
        open var focusesOnMouseDown = true
        /// Host-forced DECTCEM hide while a web overlay owns the keyboard.
        /// `internal` so `synchronizeHostFocusState` (in the +Lifecycle file)
        /// can read it when deriving Ghostty focus.
        var hostCursorHidden = false
        open var hostKeyboardActive = true {
            didSet {
                guard hostKeyboardActive != oldValue else { return }
                synchronizeHostFocusState()
            }
        }

        open var cursorSuppressed: Bool {
            !hostKeyboardActive || hostCursorHidden
        }

        /// Hide the hardware cursor while a Pier web overlay (agent composer)
        /// owns the keyboard. Implemented as a renderer-level suppress
        /// (Pier ghostty patch 0103) — immune to the TUI re-showing the
        /// cursor via `CSI ?25h`, unlike a DECTCEM write into the VT parser.
        /// `force` re-applies even when the cached state matches, covering
        /// surfaces recreated underneath the cached flag.
        public func setHostCursorHidden(_ hidden: Bool, force: Bool = false) {
            let changed = hostCursorHidden != hidden
            guard force || changed else { return }
            hostCursorHidden = hidden
            if changed {
                NSLog(
                    "[pier] setHostCursorHidden hidden=%@ hasSurface=%@",
                    hidden ? "1" : "0",
                    surface != nil ? "1" : "0"
                )
            }
            core.setCursorSuppress(hidden)
            // 转场后重新派生 Ghostty focus：hostCursorHidden 生效后
            // 让 focus=true，避免上一个 apply 遗留的 focus=false 画出 hollow。
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
            metal.isOpaque = false
            metal.backgroundColor = NSColor.clear.cgColor
            layer = metal
            metalLayer = metal
            layer?.backgroundColor = NSColor.clear.cgColor

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
            core.onPostRender = { [weak self] in
                self?.enforceMetalLayerScale()
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
