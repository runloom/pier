//
//  AppTerminalView+Lifecycle.swift
//  libghostty-spm
//
//  Created by Lakr233 on 2026/3/17.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit

    extension AppTerminalView {
        func setupTrackingArea() {
            let options: NSTrackingArea.Options = [
                .mouseEnteredAndExited,
                .mouseMoved,
                .inVisibleRect,
                .activeAlways,
            ]
            let area = NSTrackingArea(
                rect: bounds,
                options: options,
                owner: self,
                userInfo: nil
            )
            addTrackingArea(area)
        }

        override open func updateTrackingAreas() {
            super.updateTrackingAreas()
            trackingAreas.forEach { removeTrackingArea($0) }
            setupTrackingArea()
        }

        override open var acceptsFirstResponder: Bool {
            true
        }

        override open func becomeFirstResponder() -> Bool {
            let result = super.becomeFirstResponder()
            synchronizeHostFocusState()
            return result
        }

        override open func resignFirstResponder() -> Bool {
            let result = super.resignFirstResponder()
            // 不硬 apply false：让 synchronizeHostFocusState 走统一派生，
            // 允许 hostCursorHidden（web 浮层接管键盘时）仍保持 Ghostty focused=true，
            // 避免出现空心块光标。
            synchronizeHostFocusState()
            return result
        }

        override open func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            removeWindowObservers()
            if window != nil {
                // SwiftUI/AppKit can temporarily detach and reattach the terminal view while
                // diffing the view hierarchy. Rebuilding on every reattach discards Ghostty's
                // scrollback/state, so only create a new surface when one does not already exist.
                if surface == nil {
                    core.rebuildIfReady()
                } else {
                    core.synchronizeMetrics()
                }
                updateMetalLayerMetrics()
                updateColorScheme()
                core.resumeScheduledRendering()
                core.requestHostRefresh(reason: "view-attached")

                NotificationCenter.default.addObserver(
                    self,
                    selector: #selector(windowDidBecomeKey),
                    name: NSWindow.didBecomeKeyNotification,
                    object: window
                )
                NotificationCenter.default.addObserver(
                    self,
                    selector: #selector(windowDidResignKey),
                    name: NSWindow.didResignKeyNotification,
                    object: window
                )
                // Cross-display rescue: AppKit posts didChangeScreen when the
                // window's screen reference changes, even when the new screen
                // has the same backingScaleFactor (in which case
                // viewDidChangeBackingProperties does not fire). Listening
                // here lets us re-run metric sync on every screen transition
                // — required for the case where two displays share scale but
                // differ in geometry / color profile, and harmless when
                // viewDidChangeBackingProperties also fires for the
                // different-scale case.
                NotificationCenter.default.addObserver(
                    self,
                    selector: #selector(windowDidChangeScreen),
                    name: NSWindow.didChangeScreenNotification,
                    object: window
                )
            } else {
                core.suspendScheduledRendering()
                applySurfaceFocus(false)
            }
        }

        @objc func windowDidBecomeKey(_: Notification) {
            synchronizeHostFocusState()
        }

        @objc func windowDidResignKey(_: Notification) {
            applySurfaceFocus(false)
        }

        @objc func windowDidChangeScreen(_: Notification) {
            // Defer one runloop tick so AppKit's layout pass and the
            // window's new backingScaleFactor have both settled before we
            // re-derive metrics. Calling synchronously can race with the
            // layout pass and re-introduce the drift we're trying to fix.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                updateMetalLayerMetrics()
                core.synchronizeMetrics()
                core.requestHostRefresh(reason: "screen-changed")
            }
        }

        private func removeWindowObservers() {
            // Remove any existing key-window observers before registering for the
            // current window. AppKit can move the view directly between windows
            // without an intermediate nil attachment.
            NotificationCenter.default.removeObserver(
                self,
                name: NSWindow.didBecomeKeyNotification,
                object: nil
            )
            NotificationCenter.default.removeObserver(
                self,
                name: NSWindow.didResignKeyNotification,
                object: nil
            )
            NotificationCenter.default.removeObserver(
                self,
                name: NSWindow.didChangeScreenNotification,
                object: nil
            )
        }

        override open func setFrameSize(_ newSize: NSSize) {
            super.setFrameSize(newSize)
            core.fitToSize()
        }

        override open func layout() {
            super.layout()
            core.fitToSize()
        }

        override open func viewDidChangeBackingProperties() {
            super.viewDidChangeBackingProperties()
            updateMetalLayerMetrics()
            core.fitToSize()
        }

        public func fitToSize() {
            core.fitToSize()
        }

        public func flushHostResizeFrame() {
            updateMetalLayerMetrics()
            core.resizeAndRenderSynchronously()
        }

        public func synchronizeHostFocusState() {
            // 键盘路由仍走 hostKeyboardActive（见 AppTerminalView+Input.swift 各处 guard）。
            // Ghostty focus 只影响光标样式（focused=solid，unfocused=hollow）；
            // 我们希望即便被 web 浮层「接管」的那一刻也别画 hollow 出现「双光标」，
            // 所以只要窗口是 key + (是 FR 或 hostCursorHidden) 就报告 focused=true。
            // 配合 setHostCursorHidden 发出的 DECTCEM ?25l，能同时挡住 hollow 与 solid。
            let focused = window?.isKeyWindow == true
                && (window?.firstResponder === self || hostCursorHidden)
            applySurfaceFocus(focused)
        }

        private func applySurfaceFocus(_ focused: Bool) {
            guard appliedSurfaceFocus != focused else { return }
            appliedSurfaceFocus = focused
            core.setFocus(focused)
            onFocusChange?(focused)
        }

        func updateMetalLayerMetrics() {
            guard bounds.width > 0, bounds.height > 0 else { return }
            let scale = core.scaleFactor()
            // Write to the actually-attached backing layer (not just the
            // cached `metalLayer` ivar). The render pipeline can swap
            // `self.layer` to an IOSurfaceLayer for IOSurface-backed
            // compositing; once that happens the cached CAMetalLayer
            // reference is detached from the view tree and writes to its
            // contentsScale are no-ops as far as what's visible. The
            // observable symptom is text rendered at half size after the
            // window crosses to a display with a different
            // backingScaleFactor.
            layer?.contentsScale = scale
            if let metal = layer as? CAMetalLayer {
                metal.drawableSize = CGSize(
                    width: bounds.width * scale,
                    height: bounds.height * scale
                )
            }
            // Mirror to the cached ivar in case anything else still
            // reads through it during a transitional layout pass.
            metalLayer?.contentsScale = scale
            metalLayer?.drawableSize = CGSize(
                width: bounds.width * scale,
                height: bounds.height * scale
            )
        }

        func enforceMetalLayerScale() {
            let scale = core.scaleFactor()
            if let layer, layer.contentsScale != scale {
                layer.contentsScale = scale
            }
            if let metalLayer, metalLayer.contentsScale != scale {
                metalLayer.contentsScale = scale
            }
        }

        override open func viewDidChangeEffectiveAppearance() {
            super.viewDidChangeEffectiveAppearance()
            updateColorScheme()
        }

        func updateColorScheme() {
            let scheme: TerminalColorScheme = switch effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) {
            case .darkAqua: .dark
            default: .light
            }
            surface?.setColorScheme(scheme.ghosttyValue)
            if let controller,
               let viewState = delegate as? TerminalViewState,
               viewState.controller === controller
            {
                viewState.adopt(terminalColorScheme: scheme)
            } else {
                controller?.setColorScheme(scheme)
            }
        }
    }
#endif
