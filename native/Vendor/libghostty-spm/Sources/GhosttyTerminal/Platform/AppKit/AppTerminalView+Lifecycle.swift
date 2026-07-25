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
            // Ghostty focus 跟随「逻辑键盘归属」而非 AppKit first responder 瞬态。
            // 转场期间 FR 在 WKWebView ⇄ 终端之间迁移存在竞态（Chromium resign
            // 滞后/拒绝），按 FR 瞬态派生会向 TUI 发出瞬时 focus-out（ESC[O）；
            // cursor-agent 等 TUI 的输入框失焦后不随 focus-in 恢复，表现为
            // paste 进框但 Enter 不提交。hostKeyboardActive（coordinator 下发
            // 的键盘归属）与 hostCursorHidden（composer pin）都算聚焦；键盘真正
            // 切去别的面板时 hostKeyboardActive=false，仍会正确 blur。
            // pin 同时 suppress 绘制光标（仅 composer caret 闪烁）；探针仍读
            // DECTCEM 模式位，不受绘制 suppress 影响。
            //
            // 为什么仅有公式还不够、还需要 applyTerminalWindowState 的转场
            // 顺序修正（打开浮层先挂 hidden 再交 FR）——打开方向若先交 FR：
            //   ① hostKeyboardActive=false → didSet → sync：FR 仍在终端
            //     → (FR===self || …) = true，无事件；
            //   ② resignFirstResponder → sync：
            //     (✗ || hidden=false || hostKeyboardActive=false) = false
            //     → ESC[O；
            //   ③ 挂 hidden → sync → true → ESC[I。
            // 反过来，为什么仅有顺序也不够、还需要本公式——关闭方向先回 FR
            // 再摘 hidden 时，makeFirstResponder 与 WKWebView resign 竞态会
            // 让「摘 hidden 那一帧」的 FR 尚未落回终端，旧公式（FR || hidden）
            // 派生 false → ESC[O；hostKeyboardActive 入 OR 后该帧恒为 true。
            // 结论：打开方向靠顺序、关闭方向靠公式，两者缺一不可。
            //
            // 保留 FR===self 项的理由：ghostty 的 mouseDown 可能先于
            // coordinator 响应直接把终端 view 抓成 FR，该项与旧行为一致。
            let focused = window?.isKeyWindow == true
                && (window?.firstResponder === self || hostCursorHidden || hostKeyboardActive)
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
